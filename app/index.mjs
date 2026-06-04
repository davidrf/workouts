const ORIGIN_SECRET = process.env.ORIGIN_VERIFY_SECRET;

export const handler = async (event) => {
  if (!ORIGIN_SECRET || event.headers?.['x-origin-verify'] !== ORIGIN_SECRET) {
    return { statusCode: 403, headers: { 'content-type': 'text/plain' }, body: 'Forbidden' };
  }

  return {
    statusCode: 200,
    headers: { 'content-type': 'text/plain' },
    body: 'hello from workouts',
  };
};
