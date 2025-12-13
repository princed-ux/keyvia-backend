// // utils/generateId.js
// import crypto from "crypto";

// export function generateRoleId(role) {
//   const prefixMap = {
//     user: "USR",
//     agent: "AGT",
//     product_manager: "PM",
//     admin: "ADM",
//   };

//   const prefix = prefixMap[role] || "GEN";
//   const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
//   const random = crypto.randomBytes(3).toString("hex").toUpperCase();

//   return `${prefix}-${date}-${random}`;
// }


// utils/generateId.js
import crypto from "crypto";

export function generateSpecialId(role = "GEN") {
  const prefixMap = {
    user: "USR",
    agent: "AGT",
    owner: "OWN",
    buyer: "BUY",
    developer: "DEV",
    admin: "ADM",
  };

  const prefix = prefixMap[role.toLowerCase()] || prefixMap["user"];

  // Date code (DDMMYY)
  const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, "");

  // Random alphanumeric block
  const randomBytes = crypto.randomBytes(5).toString("base64").replace(/[^A-Z0-9]/gi, "").slice(0, 10).toUpperCase();

  return `${prefix}-${datePart}-${randomBytes}`;
}
