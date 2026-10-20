// Which version of the code produced a journal line: the git commit, plus "+dirty" when
// there are uncommitted changes. A skill whose code changes produces different data, so the
// world model must be able to tell data from different code versions apart.
// Computed once at startup (git is not called for every transition).
import { execSync } from 'node:child_process'
import path from 'node:path'

function computeCodeVersion() {
    const repo = path.resolve(import.meta.dirname, '../..')
    try {
        const run = (cmd) => execSync(cmd, { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
        const commit = run('git rev-parse --short HEAD')
        // Only changes to the code count (bot/ and brain/), not the data or the server
        const dirty = run('git status --porcelain -- bot brain') !== ''
        return dirty ? `${commit}+dirty` : commit
    } catch (e) {
        return 'unknown' // not a git checkout, or git not installed
    }
}

const CODE_VERSION = computeCodeVersion()

export { CODE_VERSION }