# История версий TFAF

<!-- Раздел на версию: заголовок с версией и датой, под ним части ru и en. -->

## 1.0.0 — 2026-11-16

<!-- ru -->
### Новое

- Исходный код TFAF открыт: он лежит на GitHub в репозитории tergride/tfaf под лицензией GNU GPL v3.
  - Обновления, история версий в разделе «О программе» и ссылка «Все версии на GitHub» теперь берутся из этого репозитория. Установленные версии находят его сами.
  - В папке установки появились лицензия TFAF и лицензии ресурсов из других проектов.

<!-- en -->
### New

- TFAF is now open source: its code is on GitHub in the tergride/tfaf repository under the GNU GPL v3 license.
  - Updates, the version history on the About page and the All versions on GitHub link now come from that repository. Installed versions find it by themselves.
  - The installation folder now holds TFAF's license and the licenses of assets from other projects.

## 1.0.0-beta.1 — 2026-11-16

<!-- ru -->
### Новое

- Исходный код TFAF открыт: он лежит на GitHub в репозитории tergride/tfaf под лицензией GNU GPL v3.
  - Обновления, история версий в разделе «О программе» и ссылка «Все версии на GitHub» теперь берутся из этого репозитория. Установленные версии находят его сами.
  - В папке установки появились лицензия TFAF и лицензии ресурсов из других проектов.

<!-- en -->
### New

- TFAF is now open source: its code is on GitHub in the tergride/tfaf repository under the GNU GPL v3 license.
  - Updates, the version history on the About page and the All versions on GitHub link now come from that repository. Installed versions find it by themselves.
  - The installation folder now holds TFAF's license and the licenses of assets from other projects.

## 0.19.0 — 2026-11-14

<!-- ru -->
### Новое

- Хост лобби TFAF может сбросить только настройки игры или только ограничения юнитов.
  - Кнопка сброса рядом с «Все настройки» возвращает настройки по умолчанию и оставляет запреты юнитов как есть.
  - Такая же кнопка рядом с «Ограничения юнитов» снимает только запреты.
  - Обе кнопки сначала спрашивают подтверждение, а после сброса игроки снова подтверждают готовность.
  - «Сбросить настройки» в окне настроек, как и раньше, сбрасывает и то и другое вместе с автокомандами.
- Моды в комнате лобби TFAF показаны с иконками. Пока мод не скачан, вместо иконки стоит первая буква его названия.
- Комната лобби TFAF перестроена, чтобы левой колонке хватало высоты.
  - Кнопка «Пресеты» перешла из шапки комнаты наверх колонки настроек.
  - Кнопки готовности и старта переехали под чат.
  - Строка «Все готовы» стала заметнее.

### Исправлено

- В «Обзоре карты» повёрнутые декали ложились зеркально, не на своё место. Например, коралловые рифы на Untainted Paradise оказывались на суше и были похожи на лёд.
- В лобби TFAF настройки, которые AI-моды вроде M28AI и TM28AI повторяют ради дополнительных значений (лимит юнитов, множители AIx), появлялись в окне настроек дважды. Теперь такая настройка одна, и в ней есть значения и игры, и мода.
- Мелкие неровности оформления:
  - В темах Cybran, Aeon и Seraphim выпадающие списки рядом с кнопками выглядели не в стиле темы. Это фракция и команда в строке игрока лобби TFAF, сортировка, фильтр модов в реплеях, пресеты в окне «Создание игры» и пресеты горячих клавиш.
  - При дробном «Масштабе интерфейса» или дробном масштабе Windows кольцо на ползунке было кривым, а точка в переключателе стояла не по центру.
  - Ползунки фильтров карт оставались подсвеченными, даже когда фильтр не задан.
  - Заголовки разделов стояли чуть ниже вкладок и кнопок рядом с ними, а вся строка заголовка — ниже первого пункта бокового меню.
  - В «Настройках» заголовок немного съезжал при прокрутке, прежде чем закрепиться наверху.

<!-- en -->
### New

- The host of a TFAF lobby can reset only the game options or only the unit restrictions.
  - The reset button next to All settings restores the default options and leaves unit restrictions as they are.
  - The same button next to Unit restrictions lifts only the restrictions.
  - Both buttons ask for confirmation first, and after a reset the players confirm that they are ready again.
  - Reset the options in the options dialog still resets both, along with the auto teams.
- Mods in a TFAF lobby room are shown with their icons. Until a mod is downloaded, the first letter of its name stands in for the icon.
- The TFAF lobby room has a new layout that gives the left column more height.
  - The Presets button moved from the room's header to the top of the options column.
  - The ready and start buttons moved under the chat.
  - The Everyone is ready line is easier to see.

### Fixed

- In Map overview, rotated decals were mirrored and landed in the wrong place. For example, the coral reefs on Untainted Paradise ended up on land and looked like ice.
- In a TFAF lobby, options that AI mods such as M28AI and TM28AI repeat to offer extra values (unit cap, AIx multipliers) appeared twice in the options dialog. Now there is one such option, with the values of both the game and the mod.
- Small layout glitches:
  - In the Cybran, Aeon and Seraphim themes, dropdowns next to buttons did not match the theme. These are the faction and team in a TFAF lobby player row, sorting, the mod filter in replays, presets in the Host a game dialog and key binding presets.
  - At a fractional Interface scale or Windows scaling, the ring on slider thumbs was lopsided and the dot in radio buttons was off-center.
  - The sliders of map filters stayed highlighted even when the filter was not set.
  - Page titles sat slightly lower than the tabs and buttons next to them, and the whole title row sat lower than the first sidebar item.
  - In Settings, the header slid a little on scroll before sticking to the top.

## 0.18.0 — 2026-11-14

<!-- ru -->
### Новое

- Список друзей: кнопка в заголовке окна, рядом с колокольчиком уведомлений, открывает его справа поверх любого раздела.
  - На кнопке видно, сколько друзей в сети.
  - Друзья разбиты на группы «В игре», «В лобби», «В сети» и «Не в сети». У друзей в игре и в лобби видны название игры и карта. Группа «Не в сети» по умолчанию свёрнута.
  - Правый щелчок по другу открывает то же меню игрока, что и в чате.
  - Поиск фильтрует друзей по нику и клану, а ниже показывает игроков в сети с таким ником, их можно сразу добавить в друзья. Игрока не в сети так не найти.
- Приглашения в игру (экспериментально): любой игрок открытого лобби может позвать друга, и тот войдёт без пароля.
  - Кнопка «Пригласить» есть в комнате лобби TFAF и на вкладке «Текущая игра», пока игра в лобби. В меню игрока для этого есть пункт «Пригласить в свою игру».
  - Работает и в лобби FAF, и в лобби TFAF.
  - Приглашение принимает только лаунчер TFAF 0.18 и новее, и только от друзей игрока.
  - Приглашённый получает уведомление с кнопками «Войти» и «Отклонить». Оно действует, пока игра открыта, но не дольше 10 минут.
  - Пароль лобби уходит другу в личном сообщении чата FAF.
- Значок TFAF в области уведомлений: лаунчер может работать со скрытым окном и оставаться в сети.
  - При первом закрытии окна лаунчер спрашивает, что делать: сворачиваться в область уведомлений или закрывать TFAF. Выбор потом меняется настройкой «Сворачивать в область уведомлений при закрытии окна» на вкладке «Общие».
  - Пока окно скрыто, сообщения, приглашения и уведомления продолжают приходить, а запущенная игра не прерывается.
  - В меню значка есть «Открыть окно TFAF», текущая игра, перезапуск с обновлением, папки лаунчера, выход из аккаунта и «Закрыть TFAF».
  - На значке видно число непрочитанных, а подсказка показывает, что сейчас происходит: лобби, игра, поиск матча или готовое обновление.
  - Пункт «Закрыть TFAF» есть и в меню аккаунта: он закрывает лаунчер, даже если закрытие окна сворачивает его. Закрытие во время игры закрывает и игру.
  - Перезапуск с обновлением, выход из аккаунта и закрытие лаунчера сначала спрашивают подтверждение. Вопрос перед закрытием отключается настройкой «Показывать окно подтверждения при выходе» на вкладке «Общие», но если идёт игра, предупреждение появится всё равно.
- Вход из статуса в Discord (экспериментально) работает для любого открытого лобби, где есть место, и идёт сразу, без ввода пароля.
  - Можно войти в лобби с паролем, лобби только для друзей хоста и лобби TFAF. Пароль лобби передаётся другу через Discord.
  - Друзья видят кнопку «Присоединиться», если в настройках конфиденциальности активности Discord вы разрешили друзьям присоединяться к игре. Иначе Discord показывает «Попросить присоединиться», лаунчер одобряет просьбу сам, и друг тоже входит без пароля.
  - Если лаунчер у друга закрыт, Discord запустит его, и вход продолжится после входа в аккаунт.
  - Всё это работает, пока включена настройка «Разрешить вход через Discord».
- Смотреть идущую игру из статуса в Discord больше нельзя: Discord убрал эту кнопку из своих приложений. Игру друга можно смотреть из меню игрока в чате или в списке друзей.
- «Войти в игру» в меню игрока работает и для лобби с паролем: лаунчер спросит пароль в отдельном окне.
- Меню игрока в списке участников чата теперь открывается правым щелчком, а не обычным.
- Меню игрока скрывает недоступные действия, а не делает их серыми.
  - Если в лобби войти нельзя, пункта «Войти в игру» нет, а причина написана рядом с названием игры.
  - «Пригласить в свою игру» есть только у игроков на TFAF.
  - Пункт «Пригласить в группу» теперь называется «Пригласить в группу матчмейкера». Пока ваша онлайн-игра запускается или ждёт в лобби, его нет.
  - Без связи с сервером нет пунктов добавления в друзья и во враги.
- «Выйти из аккаунта» в меню аккаунта теперь спрашивает подтверждение.
- На кнопке аккаунта в заголовке окна виден надетый аватар FAF.
- В «Настройках» заголовок и вкладки остаются наверху при прокрутке, а другая вкладка открывается с начала.
- Если выключить «Получать бета-версии» в разделе «О программе», лаунчер с бета-версией вернётся на последнюю обычную версию, а не будет ждать следующую. Обычная версия скачивается сразу и устанавливается при перезапуске.
- Тексты интерфейса на русском и английском переписаны: без жаргона и фамильярного тона, с более понятными подсказками.
- Установщик стал меньше примерно на 10 МБ, а установленный лаунчер занимает на диске примерно на 49 МБ меньше.

### Исправлено

- В окне «Создание игры» кнопка показа пароля сразу создавала игру. Так же срабатывали кнопки удаления выбранного мода и очистки поиска модов.
- В окне «Жалоба модераторам» кнопка удаления игрока из списка отправляла жалобу.
- Подписи, которые не помещались на своих местах при ширине окна от 800 до 1920 пикселей, теперь помещаются, в том числе в реплеях на вкладке «Идут сейчас».

<!-- en -->
### New

- Friends list: a button in the title bar, next to the notifications bell, opens it on the right over any section.
  - The button shows how many friends are online.
  - Friends are grouped into In a game, In a lobby, Online and Offline. Friends in a game or a lobby show the game's title and map. The Offline group is collapsed by default.
  - Right-clicking a friend opens the same player menu as in the chat.
  - The search filters friends by nickname and clan, and below them lists online players with that nickname, who can be added as friends right away. Offline players cannot be found this way.
- Game invites (experimental): any player in an open lobby can invite a friend, who then joins without the password.
  - An Invite button is in the TFAF lobby room and on the Current game tab while the game is in its lobby. The player menu has Invite to your game for the same.
  - Works in both FAF and TFAF lobbies.
  - Only TFAF 0.18 or newer takes an invite, and only from the player's friends.
  - The invited player gets a notification with Join and Decline buttons. It stays valid while the game is open, for 10 minutes at most.
  - The lobby password reaches the friend in a FAF chat private message.
- A TFAF icon in the notification area: the launcher can run with its window hidden and stay online.
  - The first time the window is closed, the launcher asks what closing should do: minimize to the notification area or quit TFAF. The choice can be changed later with Minimize to the notification area when the window is closed on the General tab.
  - While the window is hidden, messages, invites and notifications keep arriving, and a running game is not interrupted.
  - The icon's menu has Open TFAF, the current game, restart and update, the launcher folders, log out and Quit TFAF.
  - The icon shows the unread count, and its tooltip shows what is going on: a lobby, a game, a match search or a ready update.
  - Quit TFAF is in the account menu too: it quits the launcher even when closing the window minimizes it. Quitting during a game closes the game too.
  - Restart and update, log out and quitting the launcher ask for confirmation first. The question before quitting can be turned off with Show the confirmation window on exit on the General tab, but while a game is running, the warning appears anyway.
- Joining from the Discord status (experimental) works for any open lobby with room and is instant, without entering a password.
  - You can join a lobby with a password, a lobby for the host's friends only and a TFAF lobby. The lobby's password reaches the friend through Discord.
  - Friends see Join if your Discord activity privacy settings let friends join your game. Otherwise Discord shows Ask to Join, the launcher accepts the request by itself, and the friend joins without a password too.
  - If a friend's launcher is closed, Discord starts it, and joining goes on after signing in.
  - All of this works while Allow joining through Discord is on.
- A running game can no longer be watched from the Discord status, because Discord removed that button from its apps. A friend's game can be watched from the player menu in the chat or in the friends list.
- Join game in the player menu also works for lobbies with a password: the launcher asks for it in a separate dialog.
- The player menu in the chat's user list now opens with a right click instead of a left click.
- The player menu hides actions that are not available instead of graying them out.
  - When a lobby cannot be joined, there is no Join game item, and the reason is shown next to the game's title.
  - Invite to your game is shown only for players on TFAF.
  - Invite to party is now called Invite to matchmaker party. It is hidden while your online game is starting or waiting in its lobby.
  - Without a connection to the server, there are no items to add friends and foes.
- Log out in the account menu now asks for confirmation.
- The account button in the title bar shows the FAF avatar you are wearing.
- In Settings, the title and tabs stay at the top while scrolling, and another tab opens from its top.
- When Get beta versions is turned off in the About section, a launcher on a beta goes back to the latest regular version instead of waiting for the next one. The regular version downloads at once and installs on restart.
- The Russian and English interface texts are rewritten: no slang or familiar tone, and clearer hints.
- The installer is about 10 MB smaller, and the installed launcher takes about 49 MB less on disk.

### Fixed

- In the Host a game dialog, the button that shows the password created the game at once. The buttons that remove a selected mod and clear the mod search did the same.
- In the Report to the moderators dialog, the button that removes a player from the list sent the report.
- Labels that did not fit their places at window widths from 800 to 1920 pixels now fit, including the Live tab of the replays.

## 0.18.0-beta.4 — 2026-11-14

<!-- ru -->
### Новое

- Список друзей: кнопка в заголовке окна, рядом с колокольчиком уведомлений, открывает его справа поверх любого раздела.
  - На кнопке видно, сколько друзей в сети.
  - Друзья разбиты на группы «В игре», «В лобби», «В сети» и «Не в сети». У друзей в игре и в лобби видны название игры и карта. Группа «Не в сети» по умолчанию свёрнута.
  - Щелчок по другу открывает то же меню игрока, что и в чате.
  - Поиск фильтрует друзей по нику и клану, а ниже показывает игроков в сети с таким ником, их можно сразу добавить в друзья. Игрока не в сети так не найти.
- Меню игрока в чате и в списке друзей скрывает недоступные действия, а не делает их серыми.
  - Если в лобби войти нельзя, пункта «Войти в игру» нет, а причина написана рядом с названием игры.
  - «Пригласить в свою игру» есть только у игроков на TFAF.
  - Пункт «Пригласить в группу» теперь называется «Пригласить в группу матчмейкера». Пока ваша онлайн-игра запускается или ждёт в лобби, его нет.
  - Без связи с сервером нет пунктов добавления в друзья и во враги.
- Вход из статуса в Discord (экспериментально) идёт сразу: друзья видят кнопку «Присоединиться» вместо «Попросить присоединиться» и не вводят пароль лобби.
  - Кнопка «Присоединиться» появляется, если в настройках конфиденциальности активности Discord вы разрешили друзьям присоединяться к игре. Иначе Discord показывает «Попросить присоединиться», лаунчер одобряет просьбу сам, и друг тоже входит без пароля.
  - Пароль лобби передаётся другу через Discord.
  - Если у того, к кому входят, лаунчер старее этой версии, пароль спросят, как раньше.
- Смотреть идущую игру из статуса в Discord больше нельзя: Discord убрал эту кнопку из своих приложений. Игру друга можно смотреть из меню игрока в чате или в списке друзей.
- В меню аккаунта появился пункт «Закрыть TFAF». Он закрывает лаунчер, даже если закрытие окна сворачивает его в область уведомлений, и спрашивает подтверждение так же, как меню значка в области уведомлений.
- На кнопке аккаунта в заголовке окна виден надетый аватар FAF.

### Исправлено

- В окне «Создание игры» кнопка показа пароля сразу создавала игру. Так же срабатывали кнопки удаления выбранного мода и очистки поиска модов.
- В окне «Жалоба модераторам» кнопка удаления игрока из списка отправляла жалобу.

<!-- en -->
### New

- Friends list: a button in the title bar, next to the notifications bell, opens it on the right over any section.
  - The button shows how many friends are online.
  - Friends are grouped into In a game, In a lobby, Online and Offline. Friends in a game or a lobby show the game's title and map. The Offline group is collapsed by default.
  - Clicking a friend opens the same player menu as in the chat.
  - The search filters friends by nickname and clan, and below them lists online players with that nickname, who can be added as friends right away. Offline players cannot be found this way.
- The player menu in the chat and in the friends list hides actions that are not available instead of graying them out.
  - When a lobby cannot be joined, there is no Join game item, and the reason is shown next to the game's title.
  - Invite to your game is shown only for players on TFAF.
  - Invite to party is now called Invite to matchmaker party. It is hidden while your online game is starting or waiting in its lobby.
  - Without a connection to the server, there are no items to add friends and foes.
- Joining from the Discord status (experimental) is now instant: friends see Join instead of Ask to Join and don't enter the lobby's password.
  - The Join button appears if your Discord activity privacy settings let friends join your game. Otherwise Discord shows Ask to Join, the launcher accepts the request by itself, and the friend joins without a password too.
  - The lobby's password reaches the friend through Discord.
  - If the player being joined runs an older launcher than this version, the password is asked for as before.
- A running game can no longer be watched from the Discord status, because Discord removed that button from its apps. A friend's game can be watched from the player menu in the chat or in the friends list.
- The account menu has a new Quit TFAF item. It quits the launcher even when closing the window minimizes it to the notification area, and asks for confirmation the same way as the menu of the notification area icon.
- The account button in the title bar shows the FAF avatar you are wearing.

### Fixed

- In the Host a game dialog, the button that shows the password created the game at once. The buttons that remove a selected mod and clear the mod search did the same.
- In the Report to the moderators dialog, the button that removes a player from the list sent the report.

## 0.18.0-beta.3 — 2026-11-09

<!-- ru -->
### Новое

- Если выключить «Получать бета-версии» в разделе «О программе», лаунчер с бета-версией вернётся на последнюю обычную версию, а не будет ждать следующую.
  - Обычная версия скачивается сразу и устанавливается при перезапуске.
  - Если включить параметр снова до перезапуска, она не установится.
  - При возврате сбрасываются настройки, которых нет в обычной версии. Например, после обновления до 0.18.0 лаунчер снова спросит, что делать при закрытии окна.

<!-- en -->
### New

- When Get beta versions is turned off in the About section, a launcher on a beta goes back to the latest regular version instead of waiting for the next one.
  - The regular version downloads at once and installs on restart.
  - If you turn the option back on before restarting, it is not installed.
  - Going back resets the settings the regular version does not have. For example, after updating to 0.18.0 the launcher asks again what closing the window should do.

## 0.18.0-beta.2 — 2026-11-09

<!-- ru -->
### Новое

- При первом закрытии окна лаунчер спрашивает, что делать: сворачиваться в область уведомлений или закрывать TFAF.
  - Ответ запоминается, и вопрос больше не появляется. Изменить выбор можно настройкой «Сворачивать в область уведомлений при закрытии окна» на вкладке «Общие».
  - Если переключить эту настройку до первого закрытия окна, вопроса не будет.
  - «Отмена» оставляет окно открытым, и вопрос повторится при следующем закрытии.
- Вопрос перед закрытием TFAF из меню значка в области уведомлений можно отключить настройкой «Показывать окно подтверждения при выходе» на вкладке «Общие». Если идёт игра, предупреждение появляется в любом случае.

<!-- en -->
### New

- The first time the window is closed, the launcher asks what closing should do: minimize to the notification area or quit TFAF.
  - The answer is remembered, and the question does not come back. You can change it with Minimize to the notification area when the window is closed on the General tab.
  - If you switch that setting before the window is first closed, there is no question.
  - Cancel keeps the window open, and the question comes back on the next close.
- The question before quitting TFAF from the menu of its notification area icon can be turned off with Show the confirmation window on exit on the General tab. While a game is running, the warning appears anyway.

## 0.18.0-beta.1 — 2026-11-09

<!-- ru -->
### Новое

- Приглашения в игру (экспериментально): любой игрок открытого лобби может позвать друга, и тот войдёт без пароля.
  - Кнопка «Пригласить» есть в комнате лобби TFAF и на вкладке «Текущая игра», пока игра в лобби. В меню игрока в чате для этого есть пункт «Пригласить в свою игру».
  - Работает и в лобби FAF, и в лобби TFAF.
  - Приглашение принимает только лаунчер TFAF 0.18 и новее, и только от друзей игрока.
  - Приглашённый получает уведомление с кнопками «Войти» и «Отклонить». Оно действует, пока игра открыта, но не дольше 10 минут.
  - Пароль лобби уходит другу в личном сообщении чата FAF.
- «Войти в игру» в меню игрока в чате работает и для лобби с паролем: лаунчер спросит пароль в отдельном окне.
- Вход из статуса в Discord (экспериментально) работает для любого открытого лобби, где есть место, а не только для публичного без пароля.
  - Можно войти в лобби с паролем, лобби только для друзей хоста и лобби TFAF. Если у лобби есть пароль, лаунчер спросит его, а в Discord пароль не передаётся.
  - Просьбу «Попросить присоединиться» в Discord лаунчер одобряет сам.
  - Если лаунчер у друга закрыт, Discord запустит его, и вход продолжится после входа в аккаунт.
  - Всё это работает, пока включена настройка «Разрешить вход через Discord».
- Значок TFAF в области уведомлений: лаунчер может работать со скрытым окном и оставаться в сети.
  - По умолчанию кнопка закрытия и Alt+F4 прячут окно туда. Сообщения, приглашения и уведомления продолжают приходить, запущенная игра не прерывается.
  - Отключается настройкой «Сворачивать в область уведомлений при закрытии окна» на вкладке «Общие».
  - В меню значка есть «Открыть окно TFAF», текущая игра, перезапуск с обновлением, папки лаунчера, выход из аккаунта и «Закрыть TFAF».
  - На значке видно число непрочитанных, а подсказка показывает, что сейчас происходит: лобби, игра, поиск матча или готовое обновление.
  - Перезапуск с обновлением, выход из аккаунта и закрытие лаунчера сначала спрашивают подтверждение. Закрытие во время игры закрывает и игру.
- «Выйти из аккаунта» в меню пользователя теперь спрашивает подтверждение.
- Тексты интерфейса на русском и английском переписаны: без жаргона и фамильярного тона, с более понятными подсказками.
- Установщик стал меньше примерно на 10 МБ, а установленный лаунчер занимает на диске примерно на 49 МБ меньше.

### Исправлено

- Подписи, которые не помещались на своих местах при ширине окна от 800 до 1920 пикселей, теперь помещаются, в том числе в реплеях на вкладке «Идут сейчас».

<!-- en -->
### New

- Game invites (experimental): any player in an open lobby can invite a friend, who then joins without the password.
  - An Invite button is in the TFAF lobby room and on the Current game tab while the game is in its lobby. The player menu in the chat has Invite to your game for the same.
  - Works in both FAF and TFAF lobbies.
  - Only TFAF 0.18 or newer takes an invite, and only from the player's friends.
  - The invited player gets a notification with Join and Decline buttons. It stays valid while the game is open, for 10 minutes at most.
  - The lobby password reaches the friend in a FAF chat private message.
- Join game in the chat player menu also works for lobbies with a password: the launcher asks for it in a separate dialog.
- Joining from the Discord status (experimental) works for any open lobby with room, not only for a public one without a password.
  - You can join a lobby with a password, a lobby for the host's friends only and a TFAF lobby. A lobby with a password asks for it, and the password is never sent to Discord.
  - The launcher accepts Discord's Ask to Join requests by itself.
  - If a friend's launcher is closed, Discord starts it, and joining goes on after signing in.
  - All of this works while Allow joining through Discord is on.
- A TFAF icon in the notification area: the launcher can run with its window hidden and stay online.
  - By default the close button and Alt+F4 hide the window there. Messages, invites and notifications keep arriving, and a running game is not interrupted.
  - Turned off with Minimize to the notification area when the window is closed on the General tab.
  - The icon's menu has Open TFAF, the current game, restart and update, the launcher folders, log out and Quit TFAF.
  - The icon shows the unread count, and its tooltip shows what is going on: a lobby, a game, a match search or a ready update.
  - Restart and update, log out and quitting the launcher ask for confirmation first. Quitting during a game closes the game too.
- Log out in the user menu now asks for confirmation.
- The Russian and English interface texts are rewritten: no slang or familiar tone, and clearer hints.
- The installer is about 10 MB smaller, and the installed launcher takes about 49 MB less on disk.

### Fixed

- Labels that did not fit their places at window widths from 800 to 1920 pixels now fit, including the Live tab of the replays.

## 0.17.0 — 2026-11-08

<!-- ru -->
### Новое

- Сетевой адаптер TFAF надёжнее держит связь с игроками и быстрее восстанавливает её после обрыва.
  - Если до игрока есть прямой путь, связь идёт по нему, а не через TURN-сервер: ниже пинг и меньше потерь.
  - Короткий обрыв больше не переводит связь на TURN-сервер до конца игры.
  - Во время игры и в лобби TFAF лаунчер замечает зависшее соединение с сервером FAF примерно за 15 секунд вместо минуты и сразу переподключается. Через это соединение игроки договариваются о новом пути, поэтому связь возвращается быстрее.
  - Между игроками на TFAF 0.17 старое соединение не рвётся при переподключении: если сеть вернулась раньше, игра продолжается по нему.
  - Между игроками на TFAF 0.17 адаптер всё время выбирает самый быстрый путь с наименьшими потерями и сразу переходит на запасной, если текущий оборвался.
  - К игроку, который вышел из игры, адаптер больше не пытается подключиться, а недоступного пробует реже.
- Галочка «Получать бета-версии» в разделе «О программе»: с ней лаунчер обновляется и до бета-версий, которые выходят раньше обычных. Без неё ставятся только обычные версии.
- «Обзор карты» рисует карты ближе к тому, как они выглядят в игре.
  - Поддержаны шейдеры рельефа FAF, которыми сделаны многие новые карты.
  - Пропсы под водой видны сквозь неё, а деревья сверху выглядят кронами, а не крестиками.
  - Текстуры грузятся того размера, который нужен при текущем масштабе, поэтому обзор открывается быстрее и занимает меньше памяти.

### Исправлено

- «Обзор карты» правильно показывает глубину воды на старых картах вроде Maelstrom, не стирает рельеф под декалями, не рисует маркеры эффектов, которых не видно в игре, и открывает несколько официальных карт, которые раньше не читались.

<!-- en -->
### New

- The TFAF network adapter keeps the connection to other players more reliably and restores it faster after a drop.
  - When there is a direct path to a player, the connection uses it instead of a TURN server: lower ping and less loss.
  - A short drop no longer moves the connection onto a TURN server for the rest of the game.
  - During a game and in the TFAF lobby, the launcher notices a stuck connection to the FAF server in about 15 seconds instead of a minute and reconnects at once. Players agree on a new path over this connection, so the link comes back sooner.
  - Between players on TFAF 0.17, the old connection is kept while reconnecting: if the network comes back first, the game goes on over it.
  - Between players on TFAF 0.17, the adapter keeps picking the fastest path with the least loss and switches to a backup at once when the current one breaks.
  - The adapter no longer tries to reach a player who left the game, and tries an unreachable player less often.
- A Get beta versions box on the About page: with it the launcher also updates to beta versions, which come out before regular ones. Without it only regular versions are installed.
- Map overview draws maps closer to how they look in the game.
  - FAF terrain shaders, used by many newer maps, are supported.
  - Props under water show through it, and trees seen from above look like crowns rather than crosses.
  - Textures load at the size the current zoom needs, so the overview opens faster and takes less memory.

### Fixed

- Map overview shows the right water depth on old maps such as Maelstrom, keeps the terrain relief under decals, no longer draws effect markers that the game hides, and opens a few official maps it could not read before.

## 0.16.0 — 2026-11-07

<!-- ru -->
### Новое

- В лобби TFAF (экспериментальный режим) хост может убрать AI с позиции прямо из его списка: пункты «Свободно» и «Закрыто» оставляют позицию свободной или закрытой.

### Исправлено

- В лобби TFAF окно «Моды лобби» больше не открывается снова после того, как хост нажал «Применить».

<!-- en -->
### New

- In the TFAF lobby (experimental) the host can take an AI off a position right from its list: the Free and Closed entries leave the position free or closed.

### Fixed

- In the TFAF lobby the Lobby mods dialog no longer opens again after the host clicks Apply.

## 0.15.0 — 2026-11-07

<!-- ru -->
### Новое

- Новый установщик: он спрашивает папку и тип установки, обычная или Portable.
  - Обычную установку можно сделать для текущего пользователя или для всех пользователей компьютера, во втором случае Windows попросит права администратора.
  - Уже установленный лаунчер обновляется сам, как раньше, и остаётся в своей папке.
  - Portable хранит настройки лаунчера, вход, карты, моды, файлы FAF и настройки игры в папке рядом с TFAF.exe. Папку можно переносить, а в Windows такая копия не регистрируется и ярлыков не создаёт.
  - Portable не обновляется сам: закройте лаунчер, запустите новый установщик и выберите Portable и ту же папку. Об этом напоминает раздел «О программе».
  - Путь к папке Portable должен быть латиницей: игра не загружает файлы из других путей. Forged Alliance по-прежнему ставится отдельно.
  - Если у пользователя Windows нет прав на запись в C:\ProgramData\TFAF, новый профиль хранит данные в %LOCALAPPDATA%\TFAF.
- Тема «Пользовательская»: свои цвета и форма элементов лаунчера.
  - «Настроить» на её карточке в «Теме оформления» открывает редактор с предпросмотром.
  - «Тип элементов» берёт формы одной из готовых тем, а «Загрузить» у «Готовой палитры» берёт её цвета.
  - Каждый из 23 цветов, включая текст, меняется отдельно: выбором цвета или кодом #RRGGBB.
  - Тема включается кнопкой «Сохранить», а «Отмена» и Esc отбрасывают правки. Если переключиться на готовую тему, настройки пользовательской сохранятся.
  - Экран «Запуск матча» лобби TFAF (экспериментальный режим) берёт её цвета, как и цвета готовых тем.
- Текст в готовых темах стал светлее и контрастнее, а у Cybran и Seraphim больше не отдаёт желтизной.
- В теме Cybran переключатели стали просторнее, а бегунок у них шестиугольный.
- Установленные карты на странице «Карты» и в окне выбора карты фильтруются по источнику: «Официальные карты», «Карты из хранилища» и «Локальные карты».
  - Фильтры включаются вместе: тогда видны карты любого из выбранных источников.
  - Локальные — карты из папки карт, которых нет в хранилище FAF. Игроки, у которых их нет, не смогут их скачать, поэтому такие карты помечены «Локальная».
  - Без фильтров видны все установленные карты, официальные больше не скрыты.
  - Сгенерированные карты видны только без фильтров по источнику.
  - Фильтрам хранилища и локальных карт нужен вход: лаунчер сверяет папки с хранилищем FAF.
- Сортировка «Новые» и колонка «Добавлена» у установленных карт показывают, когда карту установили или скопировали на этот компьютер.
- На «Рендере» карты при создании игры и в лобби TFAF (экспериментальный режим) видны массы и гидро.
- Лаунчер сам удаляет старые логи игр, реплеев, сетевых адаптеров и генератора карт из папки данных: при запуске и после каждой игры.
  - По умолчанию удаляются логи старше 30 дней, а если логи занимают больше 500 МБ, то и самые старые. Каждое правило настраивается и выключается отдельно.
  - Логи последних суток не удаляются никогда: по ним разбирают недавнюю игру.
  - На вкладке «Обслуживание» видно, сколько места занимают логи. Там же кнопка «Очистить сейчас» и переключатель «Удалять старые логи автоматически».
- Лаунчер быстрее открывается: разделы и окна загружаются, когда их открывают впервые.
- Из сочетаний клавиш окна остались только Ctrl+R и Ctrl+Shift+R: они перезагружают интерфейс в любой раскладке. F11, масштаб, сворачивание и закрытие окна и инструменты разработчика с клавиатуры больше не работают, масштаб меняется в настройках, «Масштаб интерфейса».

### Исправлено

- В лобби TFAF (экспериментальный режим) хост больше не занимает позицию случайно: щелчок рядом со списком AI в строке позиции не доходит до строки, а щелчок мимо открытого списка только закрывает его.
- Пока игрок готов, свободные позиции в лобби TFAF больше не пульсируют и не показывают ожидание при наведении, а неактивные списки фракции и команды не откликаются на мышь.

<!-- en -->
### New

- A new installer: it asks for a folder and the installation type, standard or Portable.
  - A standard installation can be for the current user or for all users of the computer; the latter asks for administrator rights.
  - An installed launcher keeps updating by itself as before and stays in its folder.
  - Portable keeps the launcher settings, sign-in, maps, mods, FAF files and game settings in a folder next to TFAF.exe. The folder can be moved, and such a copy is not registered in Windows and creates no shortcuts.
  - Portable does not update by itself: close the launcher, run the new installer and choose Portable and the same folder. The About page reminds you of this.
  - The Portable folder needs a path in Latin letters: the game does not load its files from other paths. Forged Alliance is still installed separately.
  - If the Windows user cannot write to C:\ProgramData\TFAF, a new profile keeps its data in %LOCALAPPDATA%\TFAF.
- The Custom theme: your own colors and control shapes for the launcher.
  - Customize on its card under Theme opens an editor with a preview.
  - Control style takes the shapes of one of the built-in themes, and Load next to Built-in palette takes its colors.
  - Each of the 23 colors, text included, is set on its own, with a color picker or as #RRGGBB.
  - The theme turns on with Save, while Cancel and Esc discard the edits. Switching to a built-in theme keeps the custom settings.
  - The Launching the match screen of the TFAF lobby (experimental) uses its colors, as it does with the built-in themes.
- Text in the built-in themes is lighter and has more contrast, and in Cybran and Seraphim it no longer looks yellowish.
- In the Cybran theme switches are roomier and have a hexagonal knob.
- Installed maps on the Maps page and in the map picker can be filtered by source: Official maps, Vault maps and Local maps.
  - The filters combine: maps from any of the chosen sources are shown.
  - Local maps are maps in your maps folder that are not in the FAF vault. Players who lack them cannot download them, so such maps are marked Local.
  - Without filters all installed maps are shown; official maps are no longer hidden.
  - Generated maps show up only without source filters.
  - The vault and local filters need you to be signed in: the launcher checks the folders against the FAF vault.
- The Newest sort and the Added column of installed maps show when a map was installed or copied to this computer.
- The map Render when creating a game and in the TFAF lobby (experimental) shows mass and hydro spots.
- The launcher removes old logs of games, replays, network adapters and the map generator from the data folder by itself: at startup and after each game.
  - By default logs older than 30 days are removed, and when logs take more than 500 MB, the oldest go too. Each rule can be changed or turned off on its own.
  - Logs from the last 24 hours are never removed: they are what a recent game is investigated with.
  - The Maintenance tab shows how much space the logs take, with a Clean up now button and a Remove old logs automatically switch.
- The launcher opens faster: pages and dialogs load when you first open them.
- Only Ctrl+R and Ctrl+Shift+R are left of the window's keyboard shortcuts: they reload the interface in any keyboard layout. F11, zoom, minimizing and closing the window and the developer tools no longer work from the keyboard; the zoom is set with Interface scale in the settings.

### Fixed

- In the TFAF lobby (experimental) the host no longer takes a position by accident: a click beside the AI list in a position row no longer reaches the row, and a click outside the open list only closes it.
- While a player is ready, free positions in the TFAF lobby no longer pulse or show the wait cursor on hover, and the inactive faction and team lists no longer react to the mouse.

## 0.14.1 — 2026-11-04

<!-- ru -->
### Исправлено

- У сгенерированных карт вместо превью была пустая плашка, теперь показывается картинка, которую генератор кладёт в папку карты. Она видна в разделе «Карты», при выборе карты, на вкладке «Текущая игра» и в лобби TFAF, а у карт Neroxis, уже созданных на этом компьютере, ещё в списке игр и в реплеях.

<!-- en -->
### Fixed

- Generated maps showed an empty placeholder instead of a preview. They now show the picture the generator puts into the map folder: on the Maps page, in the map picker, on the Current game tab and in the TFAF lobby, and for Neroxis maps already made on this computer also in the game list and in replays.

## 0.14.0 — 2026-11-04

<!-- ru -->
### Новое

- Пароль закрытой игры спрашивается в отдельном окне, а не в поле на панели: и при двойном щелчке, и по кнопке «Присоединиться» на страницах «Игры» и «Кооператив».
  - Галочка «Запомнить пароль для игр …» сохраняет последний пароль этого хоста, и в следующий раз окно откроется уже с ним. Снятая галочка пароль удаляет.
  - Запомненные пароли хранятся на компьютере открытым текстом, как и пароль в пресетах игр.
  - В лобби TFAF (экспериментальный режим) лаунчер сам узнаёт у хоста, задан ли пароль, и спрашивает его только тогда. Для этого у хоста должна быть версия 0.14.0 или новее.

### Исправлено

- Если войти в игру не удалось, лаунчер называет причину на своём языке, например «неверный пароль», а не кодом сервера. Английское сообщение сервера о том же больше не попадает в уведомления.
- В теме «Командный пункт» картинки в панели подробностей и при выборе карты больше не срезаны по углам.

<!-- en -->
### New

- The password of a protected game is asked in a separate dialog instead of a field in the panel, both on a double click and with the Join button on the Games and Coop pages.
  - The "Remember the password for games of …" checkbox keeps the host's last password, and the next dialog opens with it filled in. Unticking it removes the password.
  - Remembered passwords are stored on the computer as plain text, like the password in game presets.
  - In the TFAF lobby (experimental) the launcher asks the host whether a password is set and only asks you for one then. This needs the host to be on 0.14.0 or newer.

### Fixed

- When joining a game fails, the launcher gives the reason in its own language, such as "wrong password", instead of the server's code. The server's English message about the same refusal no longer shows up in notifications.
- In the Command post theme the pictures in the detail panel and in the map picker no longer have cut corners.

## 0.13.0 — 2026-11-03

<!-- ru -->
### Новое

- Лобби TFAF (экспериментальный режим) запускает матч без лобби игры: всё решает лаунчер хоста, а игра у всех сразу открывает экран «Запуск матча».
  - Играть в таком лобби можно, только если все обновились до 0.13.0: новая версия не заходит к хосту на старой, а старые не заходят к новой.
  - Фракции, позиции, команды и имена AI лаунчер хоста раздаёт по правилам лобби FAF. Пока идёт старт, в комнате видно, кто какой фракцией и на какой позиции играет.
  - Перед стартом лаунчер ещё раз обновляет файлы мода игры. Если у кого-то они отличаются от хоста, лаунчеры сами ищут более новую сборку.
  - Если FAF изменит код запуска игры, начать матч не получится, пока не выйдет новая версия лаунчера. Комната подскажет, что лаунчер нужно обновить.
  - Если запуск не удался, игра пишет причину на экране и через 5 секунд закрывается.
- Лобби TFAF (экспериментальный режим) играет не только FAF, но и FAF Beta Balance, FAF Develop и Nomads.
  - «Мод игры» выбирается при создании игры и виден в шапке комнаты, если это не обычный FAF.
  - У Nomads в комнате есть своя фракция.
  - Если карта разрешает на позиции только некоторые фракции, другую там выбрать нельзя.
- В лобби TFAF (экспериментальный режим) AI выбираются из нового списка: и в строке позиции, и в «Управлении».
  - Поиск находит AI по его названию и по названию мода.
  - Сначала идут AI самой игры («Стандартные»), затем AI каждого мода комнаты.
  - Читерские AI спрятаны за переключателем «AIx».
- Новый выбор карты при создании игры: выбранная карта показана крупно, а «Сменить карту» открывает окно с фильтрами, карточками и таблицей, как на странице «Карты».
  - Переключатель «Превью» и «Рендер» над картой рисует установленную карту из её файлов.
  - Рядом видны до трёх недавних карт, щелчок выбирает карту сразу.
  - В окне есть вкладки «Установленные» и «Хранилище» и панель подробностей. Карта выбирается кнопкой «Выбрать карту» или двойным щелчком.
  - Кнопка «Сменить карту» в лобби TFAF открывает то же окно.
- На странице «Карты» установленные карты можно отфильтровать по числу игроков и размеру.
- Темы фракций стали мягче по цвету и получили свои контуры кнопок, полей и панелей: у UEF и Cybran углы срезаны, у Aeon и Seraphim скруглены.

<!-- en -->
### New

- The TFAF lobby (experimental) launches the match without the game's lobby: the host's launcher settles everything, and everyone's game opens straight on the Launching the match screen.
  - Such a lobby only works when everyone has updated to 0.13.0: the new version does not join a host on an older one, and older versions do not join the new one.
  - The host's launcher shares out factions, positions, teams and AI names by the rules of the FAF lobby. During a start the room shows who plays which faction at which position.
  - Before a start the launcher updates the featured mod's files once more. If someone's files differ from the host's, the launchers look for a newer build by themselves.
  - If FAF changes the code that launches the game, no match can start until a new launcher version is out. The room tells you to update the launcher.
  - If the launch fails, the game shows the reason on screen and closes after 5 seconds.
- The TFAF lobby (experimental) plays FAF Beta Balance, FAF Develop and Nomads as well as FAF.
  - The featured mod is chosen when hosting the game, and the room's header names it unless it is plain FAF.
  - Nomads brings its own faction to the room.
  - If the map allows only some factions at a position, no other faction can be picked there.
- AIs in the TFAF lobby (experimental) come from a new list, both in a position's row and under Manage.
  - The search finds an AI by its own name and by its mod's name.
  - The game's own AIs (Built-in) come first, then the AIs of each mod in the room.
  - Cheating AIs are hidden behind the AIx switch.
- A new map choice when hosting a game: the chosen map is shown large, and Change map opens a window with filters, cards and a table, like the Maps page.
  - The Preview and Render switch above the map draws an installed map from its own files.
  - Up to three recent maps are shown next to it, and a click picks one at once.
  - The window has the Installed and Vault tabs and a detail panel. A map is picked with the Choose map button or a double click.
  - The Change map button in the TFAF lobby opens the same window.
- On the Maps page, installed maps can be filtered by the number of players and by size.
- Faction themes have softer colours and their own contours of buttons, fields and panels: UEF and Cybran cut the corners, Aeon and Seraphim round them.

## 0.12.0 — 2026-10-31

<!-- ru -->
### Новое

- Темы оформления: на вкладке «Общие» в настройках можно выбрать цвета лаунчера, «Командный пункт» или палитру UEF, Aeon, Cybran или Seraphim.
- Лобби TFAF (экспериментальный режим) получило почти всё, что есть в обычном лобби FAF.
  - «Ограничения юнитов»: хост запрещает готовые наборы, отдельных юнитов и улучшения, а остальные игроки видят этот список.
  - Кнопка «Управление»: заполнить позиции AI, закрыть или открыть пустые, разбить игроков на команды, автокоманды и автобаланс.
  - «Пресеты» хранят настройки игры, запреты юнитов и моды, а новое лобби начинается с ваших прошлых настроек, фракции и цвета.
  - Хост меняет название игры прямо в лобби, задаёт правила и может назвать причину, когда выгоняет игрока.
  - Личные сообщения в чате: команда /w ник текст или клик по нику.
  - Каждый игрок выбирает свои UI-моды прямо в лобби, а на карте у позиций виден номер команды.
  - Смена карты, модов или пресета снимает готовность у всех игроков. Случайной карты в лобби нет: карту все должны знать заранее.
- Экран запуска в лобби TFAF (экспериментальный режим): пока идёт старт, лобби игры не принимает клики, а полоса вверху показывает этап и кого ждём. Если старт сорвался, игра закрывается, и все возвращаются в комнату.
- Настройка «Показывать описание обновлений» на вкладке «Уведомления» выключает окно, которое открывается после обновления лаунчера.

### Исправлено

- Матч в лобби TFAF (экспериментальный режим) больше не подхватывает настройки прошлой игры, а настройки этого лобби больше не остаются в обычном лобби.
- Подсказки больше не прячутся под диалоговыми окнами. Появляются они быстрее и плавно, без увеличения и сдвига.

<!-- en -->
### New

- Themes: on the General tab of the settings you can pick the launcher's colours, Command post or the palette of UEF, Aeon, Cybran or Seraphim.
- The TFAF lobby (experimental) now has almost everything an ordinary FAF lobby has.
  - Unit restrictions: the host bans ready-made sets, single units and upgrades, and the other players see the list.
  - The Manage button: fill positions with AI, close or open the empty ones, split players into teams, auto teams and autobalance.
  - Presets keep the game settings, unit bans and mods, and a new lobby starts with your last settings, faction and colour.
  - The host changes the game's title right in the lobby, sets the rules and can give a reason when kicking a player.
  - Private messages in chat: the command /w name text or a click on a name.
  - Every player picks their own UI mods right in the lobby, and the map shows the team number at each position.
  - Changing the map, mods or preset clears everyone's readiness. There is no random map in this lobby, because everyone has to know the map in advance.
- A start screen for the TFAF lobby (experimental): during a start the game's lobby takes no clicks, and a bar at the top shows the stage and who the game is waiting for. If the start fails, the game closes and everyone returns to the room.
- The Show what is new after an update setting on the Notifications tab turns off the window that opens after a launcher update.

### Fixed

- A match from a TFAF lobby (experimental) no longer picks up the settings of the previous game, and that lobby's settings no longer stay behind in an ordinary lobby.
- Hints no longer hide under dialogs. They also appear faster and fade in smoothly, with no zoom or slide.

## 0.11.0 — 2026-10-31

<!-- ru -->
### Новое

- Базы юнитов открываются без связи: Spooky DB и FAF Unit DB в разделе «Юниты» теперь работают из копии на диске.
  - Копия сохраняется, пока вы открываете страницы базы, и остаётся после перезапуска и обновления лаунчера.
  - При открытии лаунчер сверяется с сайтом и сам скачивает новую версию базы.
  - Кнопка «Обновить» скачивает выбранную базу заново.
- Под колокольчиком остаётся только то, что нужно прочитать, а ход запуска игры, ответы на ваши действия и события вроде заполненного лобби видны лишь во всплывающих окнах. Ошибки показываются, даже если всплывающие окна выключены.
- В лобби TFAF (экспериментальный режим) «Изоляция модов» теперь включена всегда. Если подготовить её не удалось, старт отменяется, и все возвращаются в комнату.

### Исправлено

- Тревога о том, что файлы игрока отличаются от файлов хоста, больше не звучит, пока он ещё скачивает новую карту лобби.

<!-- en -->
### New

- Unit databases open without a connection: Spooky DB and FAF Unit DB in the Units section now run from a copy on disk.
  - The copy is saved as you open the database's pages, and it stays after a restart or a launcher update.
  - On opening, the launcher checks with the site and downloads a new version of the database by itself.
  - The Refresh button downloads the selected database again.
- Only what has to be read stays under the bell, while the course of a game's start, answers to your own actions and events such as a full lobby show in pop-ups alone. Errors show even with pop-ups switched off.
- Mod isolation is now always on in a TFAF lobby (experimental). If it cannot be prepared, the start is cancelled and everyone returns to the room.

### Fixed

- The alarm about a player's files differing from the host's no longer sounds while that player is still downloading the lobby's new map.

## 0.10.0 — 2026-10-31

<!-- ru -->
### Новое

- Лобби TFAF (экспериментальный режим): при создании игры можно выбрать обычное лобби FAF или лобби прямо в лаунчере.
  - Игра запускается только по кнопке старта, сразу у всех, а матч начинается, когда соединятся все игроки.
  - Зайти могут только игроки TFAF, рейтинг в таких играх всегда выключен.
  - В лобби есть карта со стартовыми позициями, таблица игроков с цветом, фракцией, командой, рейтингом и пингом, AI, наблюдатели, моды, настройки игры с поиском и чат.
  - Хост меняет игроков местами перетаскиванием.
  - Если хост меняет карту или моды, игроки скачивают и проверяют их прямо в лобби, а готовность файлов видна у каждого.
- Настройка «Снижать нагрузку во время игры».
- «Карта как в игре» теперь называется «Обзор карты», и в нём можно выключить тени.
- Все подсказки в лаунчере теперь в едином стиле и появляются быстрее.
- Файлы FAF проверяются и обновляются один раз после входа, а не перед каждой игрой, поэтому игра запускается быстрее. Настройка, которая отключала это обновление, убрана.

### Исправлено

- Отзывы, рейтинги в профиле и жалобы снова показывают свои данные.
- Пулы карт и таблицы лидеров кооператива больше не обрезаются на ста записях.
- Файлы Game.prefs с необычными символами снова читаются.

<!-- en -->
### New

- TFAF lobby (experimental): when creating a game, choose between an ordinary FAF lobby and a lobby right in the launcher.
  - The game starts only when the host presses Start, for everyone at once, and the match begins once all players are connected.
  - Only TFAF players can join, and rating is always off in these games.
  - The lobby has a map with start positions, a player table with colour, faction, team, rating and ping, AI, observers, mods, searchable game settings and chat.
  - The host swaps players by dragging them.
  - When the host changes the map or mods, players download and check them right in the lobby, and everyone's file status is visible.
- The Reduce the load during a game setting.
- Map as in the game is now called Map overview, and its shadows can be switched off.
- All hints in the launcher now share one style and appear faster.
- FAF files are checked and updated once after login instead of before every game, so games start faster. The setting that turned this update off is gone.

### Fixed

- Reviews, profile ratings and reports show their data again.
- Map pools and coop leaderboards are no longer cut off at a hundred entries.
- Game.prefs files with unusual characters can be read again.

## 0.9.0 — 2026-10-27

<!-- ru -->
### Новое

- «Карта как в игре»: карта, которая есть на диске, открывается на весь экран и рисуется из своих файлов.
  - Видны рельеф, текстуры, декали, вода, тени, деревья и камни.
  - Карту можно приближать колесом мыши и перетаскивать.
  - Значки масс, гидро и стартов, как в лобби игры, включаются и выключаются.
  - Кнопка стоит под превью карты в играх, хранилище, реплеях, кооперативе и обучении.
  - В выборе карты при создании игры и в пуле матчмейкера кнопка появляется при наведении на миниатюру.
- Настройка «Уведомления Windows»: если её выключить, уведомления остаются только в лаунчере.

<!-- en -->
### New

- Map as in the game: a map on disk opens full screen, drawn from its own files.
  - You see relief, textures, decals, water, shadows, trees and rocks.
  - Zoom the map with the mouse wheel and drag it around.
  - Mass, hydrocarbon and start markers, as in the game lobby, can be switched on and off.
  - The button sits under map previews in games, the vault, replays, coop and tutorials.
  - In the map picker of a new game and in the matchmaker pool the button appears on hover over the thumbnail.
- The Windows notifications setting: switched off, notifications stay in the launcher only.

## 0.8.0 — 2026-10-26

<!-- ru -->
### Новое

- Вкладка «Настройки игры» в настройках лаунчера: все параметры самой игры с названиями и подсказками из игры.
  - Игровой процесс, интерфейс, видео и звук собраны в одном месте, а настройки можно искать.
  - Связанные настройки меняются вместе, как в окне настроек игры: например, пресет графики выставляет всё, что в него входит.
  - Если у игры ещё нет профиля, вкладка предлагает запустить игру, чтобы та его создала.
- Клавиши игры: выбор раскладки «Стандартная», «Hotbuild» или «Альтернативная» и назначение сочетания нажатием.
  - Лаунчер предупреждает о занятых клавишах.
  - Можно настроить Shift-варианты приказов.
  - Поиск работает и по действию, и по клавише.
- Экспорт и импорт настроек игры и клавиш в файл. При импорте можно выбрать нужные разделы, а то, что не подходит для этого компьютера, пропускается.
- Свои настройки игры в файле TFAF.prefs: он один раз копируется из Game.prefs, а дальше настройки TFAF и официального клиента не смешиваются.

<!-- en -->
### New

- The Game settings tab in the launcher settings: all options of the game itself, with the game's names and tooltips.
  - Gameplay, interface, video and sound are in one place, and options can be searched.
  - Linked options change together, as in the game's own settings dialog: a graphics preset, for example, sets everything it covers.
  - When the game has no profile yet, the tab offers to start the game so that it creates one.
- Game hotkeys: pick the Default, Hotbuild or Alternative layout and assign a combination by pressing it.
  - The launcher warns about keys already in use.
  - Shift variants of orders can be set.
  - Search works both by action and by key.
- Export and import of game settings and hotkeys to a file. An import takes the parts you choose and skips what does not fit this computer.
- Separate game settings in TFAF.prefs: it is copied from Game.prefs once, and from then on the settings of TFAF and the official client stay apart.

## 0.7.0 — 2026-10-25

<!-- ru -->
### Новое

- Лаунчер обновляется сам: новые версии он находит и скачивает без участия игрока.
- Раздел «О программе»: версия лаунчера, проверка и установка обновлений, история версий. После обновления лаунчер показывает, что нового.
- Значок TFAF: у игроков TFAF рядом с ником виден значок с версией их лаунчера.
- «Изоляция модов»: хост включает её при создании игры, и игроки TFAF подключают только моды этой игры. Лаунчер предупреждает об игроках, у которых такой функции нет, или отключает их.
- Лаунчер следит за лобби игры: выбранные там карту и моды он скачивает, сверяет с хранилищем и показывает на вкладке «Текущая игра».
- Вкладка «Текущая игра» показывает игру кратко или подробно, и выбор запоминается.
- Настройки разбиты на вкладки.
- Канал клана всегда открыт и закреплён над остальными каналами чата.
- Выбор модов отмечает моды, которых нет в хранилище FAF.
- Число игроков и размер карты в хранилище выбираются ползунками.
- Предпросмотр картинки увеличивается колесом мыши и перетаскивается.
- Флаги стран вместо кодов.

### Исправлено

- Моды, отмеченные в лобби игры, больше не перезапускают игру.
- Игра игрока закрывается сразу, как только сервер закрыл её лобби.
- Настройки чата на странице настроек снова сохраняются.
- Карты, положенные в папку самой игры, снова считаются установленными: с ними можно создать игру и зайти в неё.
- Список больше не перестраивается, когда открывается боковая панель.
- Число непрочитанных уведомлений больше не обрезается краем кнопки.
- Предложение оценить сыгранную игру больше не остаётся в списке уведомлений.
- Рядом с шагом запуска без известного прогресса больше нет лишней полосы.

<!-- en -->
### New

- The launcher updates itself: it finds and downloads new versions with no help from the player.
- The About page: the launcher's version, checking for and installing updates, and the history of versions. After an update the launcher shows what is new.
- TFAF badge: TFAF players get a badge with their launcher's version next to their name.
- Mod isolation: the host turns it on when creating a game, and TFAF players then mount only that game's mods. The launcher warns about players without this feature or disconnects them.
- The launcher follows the game lobby: it downloads the map and mods picked there, checks them against the vault and shows them on the Current game tab.
- The Current game tab shows the game briefly or in detail, and remembers the choice.
- The settings are split into tabs.
- The clan channel is always joined and pinned above the other chat channels.
- The mod picker marks mods missing from the FAF vault.
- Range sliders pick the player count and map size in the map vault.
- The image preview zooms with the mouse wheel and can be dragged.
- Country flags instead of country codes.

### Fixed

- Mods ticked in the game lobby no longer restart the game.
- A player's game closes as soon as the server closes its lobby.
- Chat settings changed on the settings page are saved again.
- Maps put into the game's own folder count as installed again: games on them can be hosted and joined.
- The list no longer reflows when the side panel opens.
- The unread notification count is no longer cut off by the edge of its button.
- The offer to review a finished game no longer stays in the notification list.
- A launch step without known progress no longer shows a pointless bar.

## 0.6.0 — 2026-10-25

<!-- ru -->
### Новое

- Сравнение файлов с хостом: вкладка «Текущая игра» показывает, чем файлы игрока отличаются от файлов хоста.
  - Игроки TFAF сверяют каждый мод.
  - О каждом новом расхождении предупреждает звук.
- Смена модов для всех: хост меняет моды на вкладке «Текущая игра» или в лобби игры, и лаунчер пересоздаёт игру. Игроки TFAF сами скачивают моды и заходят в новую игру.
- Каждая игра запускается со своей папкой модов, в которой только моды этой игры.

### Исправлено

- В играх с большим числом модов больше нет ложных расхождений с хостом.
- Моды, встроенные в саму игру, больше не скачиваются и не дают ложных расхождений.

<!-- en -->
### New

- File comparison with the host: the Current game tab shows how a player's files differ from the host's.
  - TFAF players compare every mod.
  - A sound warns about each new difference.
- Changing mods for everyone: the host changes mods on the Current game tab or in the game lobby, and the launcher hosts the game again. TFAF players download the mods and join the new game by themselves.
- Every game runs with its own mods folder, which holds only that game's mods.

### Fixed

- Games with many mods no longer show false differences from the host.
- Mods built into the game itself are no longer downloaded and no longer cause false differences.

## 0.5.0 — 2026-10-24

<!-- ru -->
### Новое

- Новое оформление: окно без системной рамки, свой заголовок, шрифты Exo 2 и IBM Plex Sans, анимации диалогов и панелей.
- Окно сжимается до 800×600: боковое меню сворачивается до значков, а в узком окне прячется за кнопку в заголовке.
- Масштаб интерфейса от 80 до 150 % и переключатель анимаций, независимые от Windows.
- Английский интерфейс, выбор языка и форматов даты и времени.
- Игры, карты, моды, реплеи и кооператив показываются карточками или таблицей.
  - Фильтры и сортировка настраиваются в самом списке.
  - Выбранный элемент открывается в панели сбоку.
- Установленные карты, моды и реплеи можно удалять пачкой.
- Списки сразу показываются из кэша, когда возвращаешься на экран.
- Центр уведомлений со всплывающими сообщениями и звуками событий. Кнопка в панели задач показывает ход запуска и загрузок и число непрочитанного.
- Профили игроков с рейтингами, графиком, достижениями, статистикой и историей ников.
- Выбор аватара и жалобы модераторам FAF.
- Игры с друзьями подсвечиваются, а в чате видно, где игрок, с кнопками «Войти в игру» и «Смотреть игру».
- Настройки чата: цвета ников, заметки об игроках, автовход в каналы, размер текста, скрытие сообщений недругов и заглушённых игроков.
- Отзывы о картах, модах и играх.
- Загрузка своих карт и модов в хранилище.
- Генерация карт: при создании игры можно сгенерировать карту Neroxis с параметрами.
- Хост переходит на новейшие версии карты и модов из хранилища.
- Реплеи показывают чат и настройки игры из файла и качество матча TrueSkill.
  - Реплей можно найти по номеру игры и поделиться ссылкой на него.
  - Просмотренные реплеи отмечаются.
  - Файлы .fafreplay открываются из проводника.
- Идущую игру можно отслеживать, пока её не станет можно смотреть.
- Игру можно запустить без сервера.
- Статус в Discord с входом в игру и просмотром из него.
- Настройка «Предпочитаемые TURN-серверы».
- Страница «Ссылки и помощь».
- Окно открывается там же, где было закрыто, и на последнем разделе.

### Исправлено

- Карта из хранилища больше не скачивается, пока её просто смотрят в списке: загрузка идёт, когда игра создана.
- Ссылки в обучающих материалах с переносом строки в адресе снова открываются.
- Боковая панель больше не дёргается, когда в ней меняется вид элемента.

<!-- en -->
### New

- A new look: a frameless window, its own title bar, the Exo 2 and IBM Plex Sans fonts, animated dialogs and panels.
- The window shrinks to 800×600: the sidebar collapses to icons and, in a narrow window, hides behind a title bar button.
- An interface scale from 80 to 150 % and an animations switch, independent of Windows.
- An English interface, with the language and the date and time formats in the settings.
- Games, maps, mods, replays and coop show as cards or a table.
  - Filters and sorting are set in the list itself.
  - The picked item opens in a side panel.
- Installed maps, mods and replays can be deleted in bulk.
- Lists show cached data at once when you come back to a screen.
- A notification center with toasts and event sounds. The taskbar button shows launch and download progress and the unread count.
- Player profiles with ratings, a rating chart, achievements, statistics and name history.
- Avatar choice and reports to the FAF moderators.
- Games with friends are highlighted, and the chat shows where a player is, with Join game and Watch game buttons.
- Chat settings: nick colors, player notes, auto-join channels, text size, hiding messages of foes and muted players.
- Reviews of maps, mods and games.
- Uploads of your own maps and mods to the vault.
- Map generation: hosting can generate a Neroxis map with parameters.
- The host moves to the newest vault versions of the map and mods.
- Replays show the chat and game options from the file and the TrueSkill match quality.
  - A replay can be found by game id and shared with a link.
  - Watched replays are marked.
  - .fafreplay files open from Explorer.
- A live game can be followed until it can be watched.
- The game can start without the server.
- Discord status with joining and watching from it.
- The Preferred TURN servers setting.
- A links and help page.
- The window reopens where it was closed and on the last section.

### Fixed

- A vault map is no longer downloaded while you only look at it in the list: the download starts once the game is created.
- Tutorial links with a line break in their address open again.
- The side panel no longer jumps when the kind of its item changes.

## 0.4.0 — 2026-10-23

<!-- ru -->
### Новое

- Вкладка «Текущая игра»: пока идёт игра, здесь видны связь, пинг и потери каждого игрока.
  - Свои файлы проверяются по хранилищу.
  - Игроки TFAF отмечены.
  - Игроки TFAF сверяют файлы игры, карту и моды, а игроки с другими файлами отмечаются.
- Вкладка «Чат»: чат FAF с каналами, личными сообщениями и историей.
  - В каналах видны участники, а в сообщениях есть ответы, реакции и превью ссылок.
  - О личных сообщениях и упоминаниях сообщают уведомления Windows.
- Вкладка «Матчмейкер»: очереди, фракции и пулы карт с вето.
  - Группы с приглашениями и своим чатом.
  - Найденный матч запускается автоматически.
  - Матчи идут и на сгенерированных картах Neroxis.
- Настройка громкости звуков лаунчера.
- В настройках можно удалить старые версии Java, Java-адаптера и генератора карт.

### Исправлено

- Фоновая проверка файлов после входа больше не тратит около 10 секунд на поиск озвучки в больших архивах FAF.

<!-- en -->
### New

- The Current game tab: while a game runs, it shows each player's connection, ping and loss.
  - Your files are checked against the vault.
  - TFAF players are marked.
  - TFAF players compare game files, the map and mods, and players whose files differ are marked.
- The Chat tab: the FAF chat with channels, private messages and history.
  - Channels show their members, and messages have replies, reactions and link previews.
  - Private messages and mentions raise Windows notifications.
- The Matchmaker tab: queues, factions and map pools with vetoes.
  - Parties with invites and their own chat.
  - A found match starts automatically.
  - Matches also run on generated Neroxis maps.
- A volume setting for the launcher's sounds.
- The settings can remove old versions of Java, the Java adapter and the map generator.

### Fixed

- The background file check after sign-in no longer spends about 10 seconds looking for voice-overs in large FAF archives.

## 0.3.0 — 2026-10-23

<!-- ru -->
### Новое

- Вкладка «Реплеи»: реплеи из хранилища FAF, из файлов и идущие игры.
  - Реплей запускается с файлами игры своей версии.
  - Реплеи своих игр сохраняются на диск.
- Вкладка «Кооператив»: кампании, миссии, открытые игры и создание миссии. У миссий есть таблица лидеров с реплеями.
- Вкладки «Новости», «Рейтинги», «Турниры» и «Юниты».
- Вкладка «Обучение»: обучающие сценарии запускают игру без сервера.
- Окно запуска игры показывает шаги и их ход. Его можно свернуть в карточку, а запуск отменить.
- Загрузки можно отменить.
- Картинка карты или мода открывается в большом предпросмотре.

<!-- en -->
### New

- The Replays tab: replays from the FAF vault, from files and live games.
  - A replay runs with the game files of its own version.
  - Replays of your own games are saved to disk.
- The Coop tab: campaigns, missions, open games and hosting a mission. Missions have a leaderboard with replays.
- The News, Leaderboards, Tournaments and Units tabs.
- The Tutorials tab: tutorials start the game without the server.
- A game launch window shows the steps and their progress. It can be minimized to a card, and the launch can be cancelled.
- Downloads can be cancelled.
- A map or mod picture opens in a large preview.

## 0.2.1 — 2026-10-22

<!-- ru -->
### Исправлено

- Вход в лобби снова работает: после изменения на сервере FAF версия 0.2.0 не могла подключиться.

<!-- en -->
### Fixed

- Signing in to the lobby works again: after a change on the FAF server, 0.2.0 could not connect.

## 0.2.0 — 2026-10-22

<!-- ru -->
### Новое

- Новый интерфейс в цветах заставки TFAF, окно-заставка при запуске и своя иконка.
- Форма создания игры запоминает черновик и именованные пресеты.
  - Карту можно поставить прямо из хранилища.
  - Недостающие моды пресета докачиваются сами.
- Перед каждой игрой карта и моды сверяются с хранилищем FAF по каждому файлу, а отличающиеся переустанавливаются.
- В настройках можно проверить файлы игры и все установленные моды и исправить найденное.
- Лаунчер переживает обрывы сети.
  - Запросы повторяются, а загрузки докачиваются.
  - Вход сохраняется без сети.
  - Результаты игры не теряются при переподключении к лобби.
- Перед закрытием во время игры лаунчер спрашивает подтверждение.
- Быстрее запуск, хранилище и проверка папок.

<!-- en -->
### New

- A new interface in the colors of the TFAF splash art, a splash window at start and an app icon.
- The create game form keeps its draft and named presets.
  - A map can be installed right from the vault.
  - A preset's missing mods download by themselves.
- Before each game the map and mods are checked file by file against the FAF vault, and anything that differs is reinstalled.
- The settings can check the game files and all installed mods and repair what differs.
- The launcher survives network drops.
  - Requests are retried and downloads resume.
  - The sign-in is kept offline.
  - Game results survive lobby reconnects.
- The launcher asks for confirmation before closing during a game.
- Faster startup, vault browsing and folder scans.

## 0.1.0 — 2026-10-21

<!-- ru -->
### Новое

- Первая версия: вход в аккаунт FAF на основном или тестовом сервере.
- Хранилище карт и модов: поиск, установка, удаление и включение модов.
- Список открытых игр в реальном времени с командами, рейтингами и модами.
- Создание игр и вход в них. Файлы FAF, которые уже есть у официального клиента, копируются у него.
- Свой сетевой адаптер без Java, совместимый с игроками официального клиента.
  - Между игроками TFAF он быстро переподключается и дублирует пакеты при потерях.
  - Видно состояние связи с каждым игроком.
- Установщик для Windows.

<!-- en -->
### New

- The first version: sign-in to a FAF account on the main or the test server.
- The map and mod vault: search, install, remove and activate mods.
- A live list of open games with teams, ratings and mods.
- Hosting and joining games. FAF files the official client already has are copied from it.
- Our own network adapter without Java, compatible with players on the official client.
  - Between TFAF players it reconnects quickly and duplicates packets while they are lost.
  - The connection to each player is shown.
- A Windows installer.
