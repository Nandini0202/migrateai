const User = require('../models/User');

async function listUsers() {
  return User.find({}).sort({ createdAt: -1 }).lean();
}

async function getUser(id) {
  return User.findById(id).populate('posts');
}

async function createUser(data) {
  const user = new User(data);
  return user.save();
}

async function removeUser(id) {
  return User.deleteOne({ _id: id });
}

module.exports = { listUsers, getUser, createUser, removeUser };
