import { plural } from '../plural.ts';

export const tournaments = {
  title: 'Турниры',
  refresh: 'Обновить список',
  site: 'Сайт турниров',
  intro: 'Записаться на турнир и следить за сеткой можно на сайте турниров FAF: вход там через аккаунт FAF.',
  show: 'Показать',
  filters: {
    current: 'Текущие и будущие',
    finished: 'Завершённые',
  },
  empty: {
    current: 'Сейчас турниров нет',
    finished: 'Завершённых турниров нет',
  },
  status: {
    running: 'Идёт',
    open: 'Регистрация открыта',
    upcoming: 'Регистрация скоро',
    closed: 'Регистрация закрыта',
    finished: 'Завершён',
  },
  formats: {
    single: 'Олимпийская система',
    double: 'Двойное выбывание',
    swiss: 'Швейцарская система',
  },
  official: 'Официальный',
  prize: 'Призовой фонд {amount}',
  teams: plural({ one: '{count} команда', few: '{count} команды', many: '{count} команд', other: '{count} команды' }),
  teamRatingTo: 'команда до {max}',
  rating: 'Рейтинг: {limits}',
  series: 'Серия: {series}',
  signupUntil: 'регистрация до {date}',
  signUp: 'Записаться',
  open: 'Открыть',
};
