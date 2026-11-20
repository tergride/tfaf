import { common } from './ru/common.ts';
import { app } from './ru/app.ts';
import { format } from './ru/format.ts';
import { login } from './ru/login.ts';
import { settings } from './ru/settings.ts';
import { games } from './ru/games.ts';
import { hostGame } from './ru/hostGame.ts';
import { currentGame } from './ru/currentGame.ts';
import { chat } from './ru/chat.ts';
import { friends } from './ru/friends.ts';
import { matchmaker } from './ru/matchmaker.ts';
import { vault } from './ru/vault.ts';
import { maps } from './ru/maps.ts';
import { mods } from './ru/mods.ts';
import { replays } from './ru/replays.ts';
import { coop } from './ru/coop.ts';
import { leaderboards } from './ru/leaderboards.ts';
import { tournaments } from './ru/tournaments.ts';
import { tutorials } from './ru/tutorials.ts';
import { news } from './ru/news.ts';
import { units } from './ru/units.ts';
import { main } from './ru/main.ts';
import { notifications } from './ru/notifications.ts';
import { profile } from './ru/profile.ts';
import { reviews } from './ru/reviews.ts';
import { links } from './ru/links.ts';
import { about } from './ru/about.ts';
import { tfafLobby } from './ru/tfafLobby.ts';
import { stoneMap } from './ru/stoneMap.ts';

// The source of the keys: every text of the interface, by screen. en.ts must have the same shape.
export const ru = {
  common,
  app,
  format,
  login,
  settings,
  games,
  hostGame,
  currentGame,
  chat,
  friends,
  matchmaker,
  vault,
  maps,
  mods,
  replays,
  coop,
  leaderboards,
  tournaments,
  tutorials,
  news,
  units,
  notifications,
  profile,
  reviews,
  links,
  about,
  tfafLobby,
  stoneMap,
  main,
};

export type Messages = typeof ru;
