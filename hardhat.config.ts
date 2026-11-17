import { defineConfig } from "hardhat/config";
import ethers from "@nomicfoundation/hardhat-ethers";

export default defineConfig({
  plugins: [ethers],
  solidity: {
    profiles: {
      default: { version: "0.8.28" },
    },
  },
  networks: {
    mstLocal: { type: "edr-simulated", chainId: 11155111 },
    ethLocal: { type: "edr-simulated", chainId: 421614 },
  },
});
