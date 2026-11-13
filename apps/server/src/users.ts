import { Router } from 'express';
import { getAddress, isAddress, isHex, verifyMessage, type Hex } from 'viem';
import { USERNAME_PATTERN, normalizeUsername, registrationMessage, type User } from '@kasi-rails/shared';
import { HttpError } from './payments';
import { AddressRegisteredError, UsernameTakenError, type OrderRepo } from './repo';

/** A registration signature must have been made within this window. */
const MAX_SIGNATURE_AGE_MS = 10 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 2 * 60 * 1000;

const USERNAME_RULES = 'Usernames are 3 to 20 letters, numbers or underscores.';

function parseUsername(raw: unknown): string {
  const username = typeof raw === 'string' ? normalizeUsername(raw) : '';
  if (!USERNAME_PATTERN.test(username)) throw new HttpError(400, USERNAME_RULES, 'BAD_USERNAME');
  return username;
}

function parseAddress(raw: unknown): Hex {
  if (typeof raw !== 'string' || !isAddress(raw)) throw new HttpError(400, 'Not a valid address.', 'BAD_REQUEST');
  return getAddress(raw);
}

/**
 * Usernames for wallets. Registration is proven by the wallet signing
 * registrationMessage(username, address, issuedAt); no passwords reach the server.
 */
export function createUsersRouter(repo: OrderRepo) {
  const router = Router();

  router.get('/check/:username', async (req, res) => {
    const raw = normalizeUsername(req.params.username);
    if (!USERNAME_PATTERN.test(raw)) {
      res.json({ username: raw, available: false, reason: USERNAME_RULES });
      return;
    }
    res.json({ username: raw, available: !(await repo.getUserByUsername(raw)) });
  });

  router.get('/by-address/:address', async (req, res) => {
    const user = await repo.getUserByAddress(parseAddress(req.params.address));
    if (!user) throw new HttpError(404, 'No account for this wallet.', 'NOT_FOUND');
    res.json(user);
  });

  router.get('/:username', async (req, res) => {
    const user = await repo.getUserByUsername(parseUsername(req.params.username));
    if (!user) throw new HttpError(404, 'No one has that username.', 'NOT_FOUND');
    res.json(user);
  });

  router.post('/', async (req, res) => {
    const username = parseUsername(req.body?.username);
    const address = parseAddress(req.body?.address);
    const issuedAt = req.body?.issuedAt;
    const signature = req.body?.signature;
    if (typeof issuedAt !== 'string' || Number.isNaN(Date.parse(issuedAt))) throw new HttpError(400, 'issuedAt must be an ISO date.', 'BAD_REQUEST');
    const age = Date.now() - Date.parse(issuedAt);
    if (age > MAX_SIGNATURE_AGE_MS || age < -MAX_CLOCK_SKEW_MS) {
      throw new HttpError(400, "This sign-up request is too old. Check your phone's clock and try again.", 'STALE');
    }
    if (typeof signature !== 'string' || !isHex(signature)) throw new HttpError(400, 'signature must be hex.', 'BAD_REQUEST');

    const valid = await verifyMessage({ address, message: registrationMessage(username, address, issuedAt), signature }).catch(() => false);
    if (!valid) throw new HttpError(400, 'The sign-up signature is not valid.', 'BAD_SIGNATURE');

    // Re-registering the same name for the same wallet is fine (e.g. a retried request).
    const existing = await repo.getUserByAddress(address);
    if (existing) {
      if (existing.username === username) {
        res.json(existing);
        return;
      }
      throw new HttpError(409, `This wallet is already registered as @${existing.username}.`, 'ADDRESS_REGISTERED');
    }

    const user: User = { username, address, createdAt: new Date().toISOString() };
    try {
      await repo.createUser(user);
    } catch (err) {
      if (err instanceof UsernameTakenError) throw new HttpError(409, `@${username} is taken. Try another username.`, 'USERNAME_TAKEN');
      if (err instanceof AddressRegisteredError) throw new HttpError(409, 'This wallet is already registered.', 'ADDRESS_REGISTERED');
      throw err;
    }
    res.status(201).json(user);
  });

  return router;
}
