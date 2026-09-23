const disposableDomains = new Set([
  'mailinator.com',
  'yopmail.com',
  'tempmail.com',
  'widenely.com',
  'rjsou.com',
  'dispostable.com',
  'sharklasers.com',
  'guerrillamail.com',
  '10minutemail.com',
  'trashmail.com',
  'getairmail.com',
  'temp-mail.org',
  'maildrop.cc'
]);

/**
 * Checks if an email belongs to a blacklisted disposable domain.
 * @param {string} email 
 * @returns {boolean} True if disposable/blacklisted, false otherwise.
 */
export const isDisposableEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  
  const domain = email.trim().toLowerCase().split('@')[1];
  if (!domain) return false;
  
  return disposableDomains.has(domain);
};
