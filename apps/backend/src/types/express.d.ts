import type { AuthContext } from '../middleware/auth';
import type { DeviceContext } from '../middleware/deviceAuth';

declare global {
  namespace Express {
    interface Request {
      /** Set by `authenticate` for every protected web route. */
      auth?: AuthContext;
      /** Set by `authenticateDevice` for Android sync routes. */
      device?: DeviceContext;
      /** Correlation id echoed in the `x-request-id` response header. */
      requestId?: string;
    }
  }
}

export {};
