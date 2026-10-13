import Post from '../models/Post.js';
import { getUser } from './userService.js';

export async function listPosts() {
  return Post.find().populate('author');
}

export async function postsPerAuthor() {
  return Post.aggregate([
    { $group: { _id: '$author', total: { $sum: 1 } } },
  ]);
}

export async function authorOf(post) {
  return getUser(post.author);
}
