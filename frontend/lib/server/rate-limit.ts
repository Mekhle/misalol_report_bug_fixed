import "server-only";

import { redis } from "./redis";

const RATE_LIMIT_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
`;

export async function withinLimit(key: string, maximum: number, seconds: number) {
  const client = redis();
  if (client.status === "wait") await client.connect();
  const count = (await client.eval(RATE_LIMIT_LUA, 1, key, seconds)) as number;
  return count <= maximum;
}
