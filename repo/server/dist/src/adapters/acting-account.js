export function runForAccount(provider, accountId, fn) {
    return provider.runForAccount ? provider.runForAccount(accountId, fn) : fn();
}
