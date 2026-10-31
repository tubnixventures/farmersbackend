/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { User } from './index.ts';
import type { TokenPayload } from '../services/auth.service.ts';

export type AppVariables = {
  user: User;
  tokenPayload: TokenPayload;
  sessionId: string;
};

export type AppEnv = {
  Variables: AppVariables;
};
