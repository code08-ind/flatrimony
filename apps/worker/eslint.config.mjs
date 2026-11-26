import { appBoundaries, base, database } from '@flatrimony/config/eslint';

export default [...base, ...appBoundaries, ...database];
