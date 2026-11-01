export const id = 'example';
export const title = 'Example Architecture';
export const subtitle = 'Scaffolding sample diagram';

export const entities = {
  'FCOM-WebApp': {
    text: 'Client web application providing UI and user interactions.',
  },
  'FDTO-UserCredentials': {
    text: 'Data transfer object containing login credentials.',
  },
  'BFUN-AuthService': {
    text: 'Authentication service validating credentials and generating session tokens.',
  },
  'BENT-Account': {
    text: 'Domain model representing an authenticated user account.',
  },
  'DBT-Users': {
    text: 'Database table storing registered user accounts and profile data.',
    columns: [
      ['id', 'serial PK', 'Unique identifier'],
      ['email', 'varchar(255)', 'User email address'],
      ['password_hash', 'varchar(255)', 'Bcrypt password hash'],
      ['created_at', 'timestamp', 'Account creation timestamp'],
    ],
  },
};

export const relations = [
  ['FCOM-WebApp', 'FDTO-UserCredentials', 'submits'],
  ['FDTO-UserCredentials', 'BFUN-AuthService', 'passes to'],
  ['BFUN-AuthService', 'BENT-Account', 'resolves'],
  ['BFUN-AuthService', 'DBT-Users', 'queries'],
  ['BENT-Account', 'DBT-Users', 'persisted as'],
];

export const pages = [
  {
    id: 'overview',
    section: 'Architecture',
    title: 'System Overview',
    intro: 'Interactive architecture diagram demonstrating React Flow components, dimensions, and database table columns.',
    entities: [
      'FCOM-WebApp',
      'FDTO-UserCredentials',
      'BFUN-AuthService',
      'BENT-Account',
      'DBT-Users',
    ],
  },
];
