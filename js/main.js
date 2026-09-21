import { startRouter } from './router.js';
import { getTheme } from './data/db.js';
import { applyTheme } from './ui/dom.js';

applyTheme(getTheme());
startRouter();