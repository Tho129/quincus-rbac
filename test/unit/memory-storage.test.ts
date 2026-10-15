import { memoryStorage } from "../../src/storage/memory";
import { storageContract } from "../support/storage-contract";

storageContract("memoryStorage", async () => ({ storage: memoryStorage(), teardown: async () => {} }));
