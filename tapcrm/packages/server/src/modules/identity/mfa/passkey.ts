import { generateAuthenticationOptions, generateRegistrationOptions } from '@simplewebauthn/server';

export async function createPasskeyRegistrationOptions(input: { rpName: string; rpId: string; userId: string; userName: string }) {
  return generateRegistrationOptions({
    rpName: input.rpName,
    rpID: input.rpId,
    userName: input.userName,
    userID: new TextEncoder().encode(input.userId),
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
}

export async function createPasskeyAuthenticationOptions(rpId: string, allowCredentials: string[]) {
  return generateAuthenticationOptions({
    rpID: rpId,
    userVerification: 'required',
    allowCredentials: allowCredentials.map((id) => ({ id })),
  });
}
