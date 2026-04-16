export type RegistrationFieldType = 'text' | 'boolean';

export interface RegistrationFieldDefinition {
  id: number;
  name: string;
  fieldType: RegistrationFieldType;
  description?: string;
  required: boolean;
}

export interface RegistrationConstraints {
  numUsersLimit: number;
}

export interface RegistrationMetadata {
  userFields: RegistrationFieldDefinition[];
  constraints: RegistrationConstraints;
}

export interface RegistrationFieldValue {
  fieldId: number;
  value: string | boolean;
}

export interface RegisterContestantPayload {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  captchaToken?: string;
  userFields: RegistrationFieldValue[];
}
