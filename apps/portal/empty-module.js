// Optional wallet integrations remain unavailable in the Portal host.
export const Porto = {
  create: () => Promise.reject(new Error("Porto connector not available")),
};

export default { Porto };
