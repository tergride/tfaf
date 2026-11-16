import { plural } from '../plural.ts';
import type { Messages } from '../ru.ts';

export const reviews: Messages['reviews'] = {
  title: 'Reviews',
  score: 'Score',
  stars: plural({ one: '{count} star', other: '{count} stars' }),
  scoreRequired: 'Give one to five stars',
  yours: 'Your review',
  writeYours: 'Write a review',
  editYours: 'Edit your review',
  rateGame: 'Rate the game',
  textPlaceholder: 'What you liked and what not (optional)',
  publish: 'Publish',
  edit: 'Edit review',
  delete: 'Delete review',
  deleteTitle: 'Delete the review?',
  deleteDescription: 'The review and its score disappear from the vault.',
  showAll: plural({ one: 'Show {count} review', other: 'Show all {count} reviews' }),
  none: 'No reviews yet',
};
