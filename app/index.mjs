import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const { TABLE_NAME, GSI_NAME, ORIGIN_VERIFY_SECRET } = process.env;

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event) => {
  if (!ORIGIN_VERIFY_SECRET || event.headers?.['x-origin-verify'] !== ORIGIN_VERIFY_SECRET) {
    return html(403, '<p>Forbidden</p>');
  }

  const method = event.requestContext.http.method;
  const path = event.rawPath;

  if (method === 'GET' && path === '/') return handleIndex();

  if (method === 'GET' && path.startsWith('/workouts/')) {
    const id = path.split('/')[2];
    if (id) return handleDetail(id);
  }

  return html(404, '<p>Not found.</p>');
};

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
    ${body}`);
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

  return html(200, `
    <a href="/" class="back">← All workouts</a>
    ${w.name ? `<h1>${esc(w.name)}</h1>` : ''}
    <p class="date">${esc(w.workout_date)}</p>
    ${photos ? `<div class="photos">${photos}</div>` : ''}
    ${details}
    ${weights}`);
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function html(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Workouts</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; color: #222; }
    a { color: #0070f3; }
    .header { display: flex; justify-content: space-between; align-items: center; }
    .btn { background: #0070f3; color: #fff; padding: .4rem .9rem; border-radius: 6px; text-decoration: none; font-size: .9rem; }
    .workout-list { list-style: none; padding: 0; }
    .workout-list li { display: flex; justify-content: space-between; padding: .6rem 0; border-bottom: 1px solid #eee; }
    .date { color: #666; font-size: .9rem; }
    .empty { color: #666; }
    .back { display: inline-block; margin-bottom: 1rem; font-size: .9rem; }
    .photos { display: flex; flex-wrap: wrap; gap: .5rem; margin: 1rem 0; }
    .photo { max-width: 100%; border-radius: 6px; }
    pre { background: #f5f5f5; padding: 1rem; border-radius: 6px; white-space: pre-wrap; }
    h2 { margin-top: 1.5rem; }
  </style>
</head>
<body>
${body}
</body>
</html>`,
  };
}
