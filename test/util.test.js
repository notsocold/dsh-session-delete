/**
 * Unit tests for the pure helpers: path encoding mirrors the JSONL backend,
 * and config merging keeps defaults on bad input.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_CONFIG, mergeConfig } from '../lib/config.js'
import { encodeSegment, normId, projectKey, sessionIdVariants } from '../lib/util.js'

test('encodeSegment mirrors the JSONL backend', () => {
  assert.equal(encodeSegment('session-1a2b'), 'session-1a2b')
  assert.equal(encodeSegment('.'), '~002E')
  assert.equal(encodeSegment('..'), '~002E~002E')
  assert.equal(encodeSegment('a/b'), 'a~002Fb')
  assert.equal(encodeSegment('a~b'), 'a~007Eb')
  assert.equal(encodeSegment('中'), '~4E2D')
})

test('projectKey mirrors the JSONL backend', () => {
  assert.equal(projectKey('/home/user/proj'), '--home-user-proj--')
  assert.equal(projectKey('C:\\work\\app'), '--C-work-app--')
  assert.equal(projectKey('/'), '--root--')
  assert.equal(projectKey('/a  b'), '--a~0020~0020b--')
})

test('session id spellings and normalization', () => {
  assert.deepEqual(sessionIdVariants('session-abc'), ['session-abc', 'abc'])
  assert.deepEqual(sessionIdVariants('abc'), ['abc'])
  assert.deepEqual(
    sessionIdVariants('12345678-1234-1234-1234-123456789abc'),
    ['12345678-1234-1234-1234-123456789abc', 'session-12345678-1234-1234-1234-123456789abc'],
  )
  assert.equal(normId('session-abc'), 'abc')
  assert.equal(normId('abc'), 'abc')
})

test('config merge validates types and keeps defaults', () => {
  const merged = mergeConfig(DEFAULT_CONFIG, {
    trashEnabled: false,
    snapshotCleanup: false,
    keepDays: 7,
    sessionsRoot: '/tmp/sessions',
    unknown: 'ignored',
  })
  assert.equal(merged.trashEnabled, false)
  assert.equal(merged.snapshotCleanup, false)
  assert.equal(merged.keepDays, 7)
  assert.equal(merged.sessionsRoot, '/tmp/sessions')
  assert.equal('unknown' in merged, false)

  const bad = mergeConfig(DEFAULT_CONFIG, {
    trashEnabled: 'yes',
    keepDays: -3,
    projCacheCleanup: 1,
  })
  assert.equal(bad.trashEnabled, DEFAULT_CONFIG.trashEnabled)
  assert.equal(bad.keepDays, DEFAULT_CONFIG.keepDays)
  assert.equal(bad.projCacheCleanup, DEFAULT_CONFIG.projCacheCleanup)
})
