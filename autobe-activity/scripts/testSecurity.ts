import assert from 'node:assert/strict';
import { getOwnedPublishedObjectKey, isOwnedPublishedObject } from '../functions/api/_shared/uploadOwnership.ts';

const base = 'https://discordmybe.pages.dev';
const owner = '123456789012345678';
const other = '987654321098765432';
const ownKey = `pub/${owner}/upload-uuid/modpack.mcaddon';
const ownUrl = `${base}/api/files/${ownKey.split('/').map(encodeURIComponent).join('/')}`;

assert.equal(getOwnedPublishedObjectKey(ownUrl, owner, base), ownKey);
assert.equal(getOwnedPublishedObjectKey(ownUrl, other, base), null, 'a different account must not publish another owner’s file');
assert.equal(getOwnedPublishedObjectKey(`${base}/api/files/pub/${other}/id/file.mcaddon`, owner, base), null);
assert.equal(getOwnedPublishedObjectKey(`${base}/api/files/temp/${owner}/id/file.mcaddon`, owner, base), null);
assert.equal(getOwnedPublishedObjectKey(`${base}/api/files/pub/${owner}/../${other}/file.mcaddon`, owner, base), null);
assert.equal(getOwnedPublishedObjectKey('javascript:alert(1)', owner, base), null);

const valid = { ownerId: owner, kind: 'pub', declaredSize: '12345' };
assert.equal(isOwnedPublishedObject(valid, 12345, owner), true);
assert.equal(isOwnedPublishedObject(valid, 12346, owner), false, 'declared size must match actual R2 object size');
assert.equal(isOwnedPublishedObject({ ...valid, ownerId: other }, 12345, owner), false);
assert.equal(isOwnedPublishedObject({ ...valid, kind: 'temp' }, 12345, owner), false);
assert.equal(isOwnedPublishedObject({ ...valid, declaredSize: '0' }, 12345, owner), false);
assert.equal(isOwnedPublishedObject(undefined, 12345, owner), false);

console.log('Security ownership tests passed.');
