import { plural } from '../plural.ts';

// Reviews of maps, mods and games in the vault panels.
export const reviews = {
  title: 'Отзывы',
  score: 'Оценка',
  stars: plural({ one: '{count} звезда', few: '{count} звезды', many: '{count} звёзд', other: '{count} звезды' }),
  scoreRequired: 'Поставьте оценку от одной до пяти звёзд',
  yours: 'Ваш отзыв',
  writeYours: 'Написать отзыв',
  editYours: 'Изменить отзыв',
  rateGame: 'Оценить игру',
  textPlaceholder: 'Что понравилось и что нет (необязательно)',
  publish: 'Опубликовать',
  edit: 'Изменить отзыв',
  delete: 'Удалить отзыв',
  deleteTitle: 'Удалить отзыв?',
  deleteDescription: 'Отзыв и оценка пропадут из хранилища.',
  showAll: plural({ one: 'Показать {count} отзыв', few: 'Показать все {count} отзыва', many: 'Показать все {count} отзывов', other: 'Показать все {count} отзыва' }),
  none: 'Отзывов пока нет',
};
