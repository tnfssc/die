declare module "*.png" {
  const embeddedPath: string;
  export default embeddedPath;
}

declare module "*.min.js" {
  const embeddedPath: string;
  export default embeddedPath;
}
