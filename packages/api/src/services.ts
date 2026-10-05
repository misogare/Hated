/** The production `ApiServices`: each one a call into `@hated/db`. */

import {
  getAccount,
  getActiveQuestionnaire,
  getAnswers,
  getDesires,
  getLatestResult,
  listMessages,
  passMatch,
  saveAnswers,
  saveDesires,
  saveProfile,
  sayHello,
  sendMessage,
  setProfileActive,
  startSignIn,
  verifyCode,
  type Mailer,
  type PrismaClient,
} from '@hated/db';

import type { ApiServices } from './app.js';

export function createDbServices(prisma: PrismaClient, mailer: Mailer): ApiServices {
  return {
    startSignIn: (email) => startSignIn(prisma, { email }, { mailer }),
    verifyCode: (input) => verifyCode(prisma, input),
    getAccount: (userId) => getAccount(prisma, userId),
    saveProfile: (userId, input) => saveProfile(prisma, userId, input),
    setProfileActive: (userId, active) => setProfileActive(prisma, userId, active),
    getQuestionnaire: () => getActiveQuestionnaire(prisma),
    getAnswers: (userId) => getAnswers(prisma, userId),
    saveAnswers: (userId, answers) => saveAnswers(prisma, userId, answers),
    getDesires: (userId) => getDesires(prisma, userId),
    saveDesires: (userId, desires) => saveDesires(prisma, userId, desires),
    getLatestResult: (userId) => getLatestResult(prisma, userId),
    sayHello: (userId, matchId) => sayHello(prisma, userId, matchId),
    passMatch: (userId, matchId) => passMatch(prisma, userId, matchId),
    listMessages: (userId, matchId, after) => listMessages(prisma, userId, matchId, { after }),
    sendMessage: (userId, matchId, body) => sendMessage(prisma, userId, matchId, body),
  };
}
