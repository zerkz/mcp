// NOTE: Theoretically, we shouldn't need this, but having the mocha tests running alongside the
//       vitest tests means that we run into problems where the test runner tries to use mocha instead.
//       It's dumb, but here we are.
import {describe, it, expect} from "vitest"

describe('asdfasdfasdf', () => {
    it('math works', () => {
        expect(2 + 2).toEqual(4);
    })
})