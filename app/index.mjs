import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const { TABLE_NAME, GSI_NAME, PHOTOS_BUCKET, ORIGIN_VERIFY_SECRET } = process.env;

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const EXT_MAP = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
  'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic',
};

export const handler = async (event) => {
  if (!ORIGIN_VERIFY_SECRET || event.headers?.['x-origin-verify'] !== ORIGIN_VERIFY_SECRET) {
    return html(403, '<p>Forbidden</p>');
  }

  try {
    const method = event.requestContext.http.method;
    const path = event.rawPath;

    if (method === 'GET'  && path === '/')              return handleIndex();
    if (method === 'GET'  && path === '/workouts/new')  return handleNew();
    if (method === 'POST' && path === '/api/uploads')   return handleUploads(event);
    if (method === 'POST' && path === '/workouts')      return handleCreate(event);

    if (method === 'GET' && path.startsWith('/workouts/')) {
      const id = path.split('/')[2];
      if (id) return handleDetail(id);
    }

    return html(404, '<p>Not found.</p>');
  } catch (err) {
    console.error(err);
    return html(500, '<p>Something went wrong. <a href="/">Back</a></p>');
  }
};

// ── Read path ────────────────────────────────────────────────────────────────

async function handleIndex() {
  const result = await dynamo.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': 'WORKOUT' },
    ScanIndexForward: false,
  }));

  const items = result.Items ?? [];
  const body = items.length === 0
    ? `<p class="empty">No workouts yet. <a href="/workouts/new">Add one</a>.</p>`
    : `<ul class="workout-list">${items.map(w => `
        <li>
          <a href="/workouts/${esc(w.id)}">${esc(w.name || w.workout_date)}</a>
          <span class="date">${esc(w.workout_date)}</span>
        </li>`).join('')}
      </ul>`;

  return html(200, `
    <div class="header">
      <h1>Workouts</h1>
      <a href="/workouts/new" class="btn">+ Add workout</a>
    </div>
    ${body}`, 'Workouts');
}

async function handleDetail(id) {
  const result = await dynamo.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: GSI_NAME,
    KeyConditionExpression: 'id = :id',
    ExpressionAttributeValues: { ':id': id },
  }));

  const w = result.Items?.[0];
  if (!w) return html(404, '<p>Workout not found. <a href="/">Back</a></p>');

  const photos = (w.photo_keys ?? []).map(key =>
    `<img src="/${esc(key)}" alt="Workout photo" class="photo">`
  ).join('');

  const details = w.details
    ? `<h2>Details</h2><pre>${esc(w.details)}</pre>`
    : '';

  const weights = w.recommended_weights
    ? `<h2>Recommended weights</h2><pre>${esc(w.recommended_weights)}</pre>`
    : '';

  const pageTitle = `${esc(w.name || w.workout_date)} – Workouts`;

  return html(200, `
    <a href="/" class="back">← All workouts</a>
    ${w.name ? `<h1>${esc(w.name)}</h1>` : ''}
    <p class="date">${esc(w.workout_date)}</p>
    ${photos ? `<div class="photos">${photos}</div>` : ''}
    ${details}
    ${weights}`, pageTitle);
}

// ── Write path ───────────────────────────────────────────────────────────────

function handleNew() {
  return html(200, `
    <a href="/" class="back">← All workouts</a>
    <h1>Add workout</h1>
    <form id="workout-form" method="post" action="/workouts">
      <div class="field">
        <label for="workout_date">Date <span class="req">*</span></label>
        <input type="date" id="workout_date" name="workout_date" required>
      </div>
      <div class="field">
        <label for="name">Name</label>
        <input type="text" id="name" name="name" placeholder="e.g. Hero WOD">
      </div>
      <div class="field">
        <label for="photos">Photos</label>
        <input type="file" id="photos" name="photos" multiple accept="image/*">
      </div>
      <div class="field">
        <label for="details">Details</label>
        <textarea id="details" name="details" rows="4" placeholder="5 rounds: 10 pull-ups…"></textarea>
      </div>
      <div class="field">
        <label for="recommended_weights">Recommended weights</label>
        <textarea id="recommended_weights" name="recommended_weights" rows="3" placeholder="KB: 24kg / 16kg"></textarea>
      </div>
      <button type="submit" class="btn" id="submit-btn">Save workout</button>
      <span id="upload-status"></span>
    </form>
    <script>
      document.getElementById('workout_date').valueAsDate = new Date();

      function addHidden(form, name, value) {
        const el = document.createElement('input');
        el.type = 'hidden'; el.name = name; el.value = value;
        form.appendChild(el);
      }

      document.getElementById('workout-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        const btn = document.getElementById('submit-btn');
        const status = document.getElementById('upload-status');
        const files = Array.from(document.getElementById('photos').files);

        btn.disabled = true;
        if (files.length) {
          status.textContent = 'Uploading photos…';
          try {
            const res = await fetch('/api/uploads', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(files.map(f => ({
                filename: f.name,
                contentType: f.type || 'image/jpeg',
              }))),
            });
            if (!res.ok) throw new Error('Upload init failed');
            const { id, uploads } = await res.json();
            await Promise.all(uploads.map((u, i) =>
              fetch(u.url, {
                method: 'PUT',
                headers: { 'content-type': files[i].type || 'image/jpeg' },
                body: files[i],
              })
            ));
            addHidden(form, 'id', id);
            uploads.forEach(u => addHidden(form, 'photo_keys', u.key));
          } catch (err) {
            status.textContent = 'Upload failed. Try again.';
            btn.disabled = false;
            return;
          }
        }

        status.textContent = 'Saving…';
        form.submit();
      });
    </script>`, 'Add workout – Workouts');
}

async function handleUploads(event) {
  let files;
  try {
    files = JSON.parse(event.body ?? '[]');
  } catch {
    return { statusCode: 400, headers: { 'content-type': 'application/json' }, body: '{"error":"bad request"}' };
  }

  if (!Array.isArray(files) || files.length === 0) {
    return { statusCode: 400, headers: { 'content-type': 'application/json' }, body: '{"error":"no files"}' };
  }

  for (const { contentType } of files) {
    if (!contentType || !contentType.startsWith('image/')) {
      return { statusCode: 400, headers: { 'content-type': 'application/json' }, body: '{"error":"non-image type"}' };
    }
  }

  const id = crypto.randomUUID();
  const uploads = await Promise.all(files.map(async ({ contentType }) => {
    const ext = EXT_MAP[contentType] ?? 'jpg';
    const key = `photos/${id}/${crypto.randomUUID()}.${ext}`;
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: PHOTOS_BUCKET, Key: key, ContentType: contentType }),
      { expiresIn: 300 },
    );
    return { url, key };
  }));

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, uploads }),
  };
}

async function handleCreate(event) {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString()
    : (event.body ?? '');
  const params = new URLSearchParams(raw);

  const workout_date = params.get('workout_date') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workout_date)) {
    return html(400, '<p>Invalid or missing workout date. <a href="/workouts/new">Back</a></p>');
  }

  const id          = params.get('id') || crypto.randomUUID();
  const name        = params.get('name')?.trim()                || undefined;
  const details     = params.get('details')?.trim()             || undefined;
  const recommended_weights = params.get('recommended_weights')?.trim() || undefined;
  const photo_keys  = params.getAll('photo_keys').filter(Boolean);

  const item = {
    pk: 'WORKOUT',
    sk: `${workout_date}#${id}`,
    id,
    workout_date,
    created_at: new Date().toISOString(),
    photo_keys,
  };
  if (name)                item.name = name;
  if (details)             item.details = details;
  if (recommended_weights) item.recommended_weights = recommended_weights;

  await dynamo.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

  return { statusCode: 302, headers: { location: `/workouts/${id}` }, body: '' };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function html(statusCode, body, title = 'Workouts') {
  return {
    statusCode,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; color: #222; }
    a { color: #0070f3; }
    .header { display: flex; justify-content: space-between; align-items: center; }
    .btn { background: #0070f3; color: #fff; padding: .4rem .9rem; border-radius: 6px; text-decoration: none; font-size: .9rem; cursor: pointer; border: none; }
    .btn:disabled { opacity: .5; cursor: default; }
    .workout-list { list-style: none; padding: 0; }
    .workout-list li { display: flex; justify-content: space-between; padding: .6rem 0; border-bottom: 1px solid #eee; }
    .date { color: #666; font-size: .9rem; }
    .empty { color: #666; }
    .back { display: inline-block; margin-bottom: 1rem; font-size: .9rem; }
    .photos { display: flex; flex-wrap: wrap; gap: .5rem; margin: 1rem 0; }
    .photo { max-width: 100%; border-radius: 6px; }
    pre { background: #f5f5f5; padding: 1rem; border-radius: 6px; white-space: pre-wrap; }
    h2 { margin-top: 1.5rem; }
    .field { margin-bottom: 1.2rem; display: flex; flex-direction: column; gap: .3rem; }
    label { font-size: .9rem; font-weight: 500; }
    .req { color: #c00; }
    input[type=text], input[type=date], textarea { padding: .4rem .6rem; border: 1px solid #ccc; border-radius: 6px; font: inherit; width: 100%; box-sizing: border-box; }
    textarea { resize: vertical; }
    #upload-status { font-size: .85rem; color: #666; margin-left: .8rem; }
  </style>
</head>
<body>
${body}
</body>
</html>`,
  };
}
