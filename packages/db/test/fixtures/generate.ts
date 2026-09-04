// Regenerates the static fixture files from the builders in ../helpers.ts:  node --import tsx packages/db/test/fixtures/generate.ts
import { writeFileSync } from 'node:fs';
import { attachmentNames } from '@automax/contracts/names';
import { buildMessages, buildPwJson, TINY_PNG_BASE64 } from '../helpers.js';
const PW = 'demo-shop--ui--chromium';
const dir = new URL('.', import.meta.url).pathname;
writeFileSync(
  `${dir}/simple-pass.ndjson`,
  buildMessages(
    [
      {
        uri: 'features/ui/login.feature',
        name: 'Login',
        tags: ['@ui'],
        scenarios: [
          {
            name: 'Successful login',
            tags: ['@smoke', '@jira:DEMO-1'],
            steps: [
              { keyword: 'Given', text: 'I am on the login page' },
              { keyword: 'When', text: 'I login with "standard_user" and "secret_sauce"' },
              { keyword: 'Then', text: 'I should see the inventory' },
            ],
          },
          {
            name: 'Failed login',
            tags: ['@regression'],
            exampleRows: 2,
            steps: [
              { keyword: 'Given', text: 'I am on the login page' },
              { keyword: 'Then', text: 'I should see the login error "<message>"' },
            ],
          },
        ],
      },
    ],
    { pwProject: PW },
  ),
);
writeFileSync(
  `${dir}/retry-flaky.ndjson`,
  buildMessages(
    [
      {
        uri: 'features/ui/cart.feature',
        name: 'Cart',
        tags: ['@ui'],
        scenarios: [
          {
            name: 'Add to cart',
            tags: ['@regression'],
            steps: [
              { keyword: 'Given', text: 'I am on the inventory page' },
              { keyword: 'When', text: 'I add the first product' },
              { keyword: 'Then', text: 'the cart badge shows 1' },
            ],
            attempts: [
              ['PASSED', 'FAILED', 'PASSED'],
              ['PASSED', 'PASSED', 'PASSED'],
            ],
          },
        ],
      },
    ],
    { pwProject: PW },
  ),
);
writeFileSync(
  `${dir}/two-shards/messages.shard-1.ndjson`,
  buildMessages(
    [
      {
        uri: 'features/api/posts.feature',
        name: 'Posts',
        tags: ['@api'],
        scenarios: [
          {
            name: 'List posts',
            tags: ['@smoke'],
            steps: [
              { keyword: 'When', text: 'I send a GET request to "/posts"' },
              { keyword: 'Then', text: 'the response status should be 200' },
            ],
          },
        ],
      },
    ],
    { pwProject: 'demo-shop--api' },
  ),
);
writeFileSync(
  `${dir}/two-shards/messages.shard-2.ndjson`,
  buildMessages(
    [
      {
        uri: 'features/api/posts.feature',
        name: 'Posts',
        tags: ['@api'],
        scenarios: [
          {
            name: 'Create post',
            tags: ['@regression'],
            steps: [
              {
                keyword: 'When',
                text: 'I send a POST request to "/posts"',
                status: 'FAILED',
                error: 'expect(received).toBe(expected)\n\nExpected: 201\nReceived: 500',
              },
            ],
          },
        ],
      },
    ],
    { pwProject: 'demo-shop--api', startMs: Date.parse('2026-09-03T10:05:00.000Z') },
  ),
);
writeFileSync(
  `${dir}/with-attachments.ndjson`,
  buildMessages(
    [
      {
        uri: 'features/ui/login.feature',
        name: 'Login',
        tags: ['@ui'],
        scenarios: [
          {
            name: 'Login with heal',
            tags: ['@regression'],
            steps: [
              {
                keyword: 'Given',
                text: 'I am on the login page',
                attachments: [
                  {
                    name: attachmentNames.shotStep(0, 'before'),
                    mediaType: 'image/png',
                    body: TINY_PNG_BASE64,
                    encoding: 'BASE64',
                  },
                  {
                    name: attachmentNames.shotStep(0, 'after'),
                    mediaType: 'image/png',
                    body: TINY_PNG_BASE64,
                    encoding: 'BASE64',
                  },
                  {
                    name: attachmentNames.meta,
                    mediaType: 'application/json',
                    body: JSON.stringify({ fingerprint: 'x', testId: 't1', tags: ['@ui'] }),
                  },
                ],
              },
              {
                keyword: 'When',
                text: 'I send a GET request to "/users/1"',
                attachments: [
                  {
                    name: attachmentNames.api(1, 1, 'request'),
                    mediaType: 'application/json',
                    body: JSON.stringify({
                      method: 'GET',
                      url: 'https://api/users/1',
                      headers: {},
                    }),
                  },
                  {
                    name: attachmentNames.api(1, 1, 'response'),
                    mediaType: 'application/json',
                    body: JSON.stringify({
                      status: 200,
                      statusText: 'OK',
                      headers: {},
                      body: { id: 1 },
                      responseTime: 42,
                    }),
                  },
                ],
              },
              {
                keyword: 'Then',
                text: 'I click the "Login" button',
                attachments: [
                  {
                    name: attachmentNames.heal(2, 1),
                    mediaType: 'application/json',
                    body: JSON.stringify({
                      stepIndex: 2,
                      action: 'click',
                      description: 'login button',
                      pageUrl: 'https://x/',
                      originalSelector: '#login-button',
                      context: { role: 'button', name: 'Login' },
                      strategyUsed: 'role',
                      healedSelector: "getByRole('button', { name: 'Login' })",
                      candidates: [
                        {
                          strategy: 'role',
                          selector: "getByRole('button', { name: 'Login' })",
                          score: 1,
                        },
                      ],
                      succeeded: true,
                      durationMs: 312,
                      at: '2026-09-03T10:00:01.000Z',
                    }),
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    { pwProject: PW },
  ),
);
writeFileSync(
  `${dir}/pw-results.json`,
  buildPwJson({
    projectName: 'demo-shop--recorded--chromium',
    file: 'projects/demo-shop/recorded/checkout.spec.ts',
    title: 'checkout happy path',
    results: [
      {
        status: 'failed',
        retry: 0,
        error: "locator.click: Timeout 5000ms exceeded.\nwaiting for getByTestId('checkout')",
      },
      { status: 'passed', retry: 1 },
    ],
  }),
);
console.log('fixtures written');
