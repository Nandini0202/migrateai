const express = require('express');
const userService = require('../services/userService');

const router = express.Router();

router.get('/', async (req, res) => {
  res.json(await userService.listUsers());
});

router.get('/:id', async (req, res) => {
  res.json(await userService.getUser(req.params.id));
});

router.post('/', async (req, res) => {
  res.status(201).json(await userService.createUser(req.body));
});

module.exports = router;
