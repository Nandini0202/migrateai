const { MongoClient } = require('mongodb');

async function run(uri) {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('app');
  const rows = await db.collection('users').find({ active: true }).toArray();
  await db.collection('logs').insertOne({ at: new Date() });
  return rows;
}

module.exports = { run };
