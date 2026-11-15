import path from 'node:path';

/** Keep passive discovery inside fixtures, including tests that only visit the web UI. */
export function isolatedProviderBinaries(directory: string) {
  return { claudeBin: path.join(directory, 'uninstalled-claude'), codexBin: path.join(directory, 'uninstalled-codex'), opencodeBin: path.join(directory, 'uninstalled-opencode') };
}

/** Local diagnostics succeed independently of the fixture's generation response. */
export function providerHandshake(agent: 'claude' | 'codex'): string {
  const version = agent === 'claude' ? '2.1.0 (Claude Code)' : 'codex-cli 0.164.0';
  const auth = agent === 'claude' ? JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }) : 'Logged in using ChatGPT';
  return `const args=process.argv.slice(2);
if(args.includes('--version')){console.log(${JSON.stringify(version)});process.exit(0)}
if(args.includes('--help')){console.log('--tools --strict-mcp-config --disallowedTools --ignore-user-config --ignore-rules --ephemeral --disable');process.exit(0)}
if(args.join(' ')==='${agent === 'claude' ? 'auth' : 'login'} status'){console.log(${JSON.stringify(auth)});process.exit(0)}
`;
}
