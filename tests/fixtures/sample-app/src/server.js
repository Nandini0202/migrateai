const express = require('express');
const connectDB = require('./config/db');
const userRoutes = require('./routes/userRoutes');
const postRoutes = require('./routes/postRoutes');
const report = require('./reports/nativeReport');
const { findItem } = require('./utils/helpers');

const app = express();
app.use(express.json());
app.use('/users', userRoutes);
app.use('/posts', postRoutes);
app.get('/report', async (req, res) => res.json(await report.run(process.env.MONGO_URI)));
app.get('/item/:id', (req, res) => res.json(findItem(Number(req.params.id))));

connectDB(process.env.MONGO_URI).then(() => app.listen(3000));
