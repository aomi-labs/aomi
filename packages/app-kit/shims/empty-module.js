// Optional wallet integrations remain unavailable in the app hosts.
export const Porto = {
  create: () => Promise.reject(new Error("Porto connector not available")),
};

export default { Porto };
