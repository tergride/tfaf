// The bell in the title bar, the toasts, and the notifications the main process makes.
export const notifications = {
  title: 'Уведомления',
  empty: 'Уведомлений пока нет',
  clear: 'Очистить',
  dismiss: 'Скрыть',
  close: 'Закрыть',
  actionFailed: 'Не удалось выполнить действие: {error}',
  taskbarBadge: 'Непрочитанных: {count}',
  sources: {
    server: 'Сообщение сервера',
    game: 'Игра',
    chat: 'Чат',
    matchmaker: 'Матчмейкер',
  },
  gameTitle: '«{title}»',
  untitledGame: 'Без названия',
  friends: {
    online: '{login} в сети',
    offline: '{login} не в сети',
    joinedGame: '{login} в лобби игры',
    startedPlaying: '{login} в игре',
  },
  gameFull: {
    title: 'Все слоты заняты',
    body: 'Можно начинать игру',
  },
  gameEnded: {
    title: 'Игра окончена',
    body: 'Оцените игру. Отзыв будет виден всем в хранилище реплеев',
    review: 'Оценить',
  },
  gameFailed: {
    title: 'Игра завершилась с ошибкой',
    minimized:
      'Игра была свёрнута. В полноэкранном режиме сворачивание и Alt+Tab могут приводить к аварийному завершению игры, поэтому рекомендуется оконный режим.',
    sound:
      'В логе игры есть ошибки звуковой системы XACT. Обычно их вызывают настройки звука Windows или сторонние звуковые программы. Способы решения описаны на форуме FAF.',
    openLog: 'Открыть лог',
    moreInfo: 'Подробнее',
  },
  replayFile: {
    failed: 'Не удалось открыть реплей',
    missing: 'Файл не найден: {file}',
  },
  update: {
    title: 'Загружено обновление {version}',
    body: 'Обновление будет установлено при перезапуске лаунчера.',
    restart: 'Перезапустить',
  },
};
