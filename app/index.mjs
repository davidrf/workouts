export const handler = async (event) => {
  return {
    statusCode: 200,
    headers: { "content-type": "text/plain" },
    body: "hello from workouts",
  };
};
