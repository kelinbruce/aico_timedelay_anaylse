/** Browser E2E rationale: exercise TC-SI-094 against a real packed candidate without route interception. */
import { test } from '@playwright/test';
import { runBrowserCase } from '../../helpers/browser-black-box.js';
test('TC-SI-094', async ({ page }) => runBrowserCase('TC-SI-094', page));
