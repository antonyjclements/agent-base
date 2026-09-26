/**
 * Whether this process was started inside a cmux terminal. cmux exports `CMUX_WORKSPACE_ID` and
 * `CMUX_SURFACE_ID` to everything it starts (seen in a process it launched), and those two together are
 * the signal: either alone could be left over from something else. That matters because cmux's socket only
 * answers processes started inside it, so this is also the answer to "can the terminal launcher work here".
 */
const set = (v) => typeof v === 'string' && v.trim().length > 0

export const insideCmux = (env = process.env) => set(env.CMUX_WORKSPACE_ID) && set(env.CMUX_SURFACE_ID)
