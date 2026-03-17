export const TEST_USER_EMAIL = 'testuser@pricingspy.com'
export const TEST_USER_PASSWORD = 'Testuser123'

export const isTestUserEmail = (email?: string | null) =>
  (email ?? '').trim().toLowerCase() === TEST_USER_EMAIL
