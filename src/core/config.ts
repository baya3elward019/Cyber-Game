/** Game-wide configuration. Change values here, not in code. */
export const CONFIG = {
  version: '0.4.0',
  /** Where "Send feedback" goes. Leave empty to hide the button.
   *  Example: 'https://github.com/USERNAME/REPOSITORY/issues/new' or a Google Form link. */
  feedbackUrl: '',
  /** Labs in board order. Only labs with playable missions are marked available. */
  labs: ['soc', 'network', 'coding', 'cloud', 'forensics', 'crypto'] as const,
};
