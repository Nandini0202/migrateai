const express = require('express');
const postService = require('../services/postService');

const router = express.Router();

router.get('/', async (req, res) => {
  res.json(await postService.listPosts());
});

module.exports = router;
