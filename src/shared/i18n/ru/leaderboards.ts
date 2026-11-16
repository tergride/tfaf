import { plural } from '../plural.ts';

export const leaderboards = {
  title: 'Рейтинги',
  season: 'Сезон',
  seasonNumber: 'Сезон {number}',
  seasonWithDates: 'Сезон {number} · {dates}',
  // leagues.divisionName.* of the official client.
  divisions: {
    bronze: 'Бронза',
    silver: 'Серебро',
    gold: 'Золото',
    diamond: 'Алмаз',
    master: 'Мастер',
    grandmaster: 'Грандмастер',
  },
  me: {
    title: 'Ваше место',
    rank: '{rank} место из {total}',
    pointsToPromotion: 'Очки до повышения',
    seasonGames: plural({
      one: '{count} игра в сезоне',
      few: '{count} игры в сезоне',
      many: '{count} игр в сезоне',
      other: '{count} игры в сезоне',
    }),
    placement: 'Калибровка',
    gamesPlayed: 'Сыграно игр',
    placementHint: 'После калибровочных игр система определит ваш дивизион.',
    notInSeason: 'Вас нет в этом сезоне. Сыграйте в рейтинговой очереди, чтобы попасть в лигу.',
  },
  distribution: 'Распределение по дивизионам',
  noDivisions: 'В этом сезоне ещё нет дивизионов',
  subdivision: 'Поддивизион',
  find: {
    login: 'Ник игрока',
    submit: 'Найти',
    notFound: 'Игрока «{login}» нет в рейтинге этого сезона',
  },
  ratingRange: 'Рейтинг игроков дивизиона: {min} – {max}',
  ratingRangeWithPromotion: 'Рейтинг игроков дивизиона: {min} – {max} · для повышения нужно {score} очков',
  emptyDivision: 'В этом дивизионе пока никого нет',
  emptyDivisionHint: 'Выберите другой дивизион.',
  table: {
    label: 'Игроки дивизиона',
    rank: 'Место',
    player: 'Игрок',
    score: 'Очки',
    games: 'Игры',
  },
};
