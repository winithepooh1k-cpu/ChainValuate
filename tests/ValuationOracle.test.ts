import { describe, it, expect, beforeEach } from "vitest";
import { stringUtf8CV, uintCV } from "@stacks/transactions";

const ERR_NOT_ORACLE = 100;
const ERR_INVALID_PROPERTY_ID = 101;
const ERR_INVALID_PRICE = 102;
const ERR_INSUFFICIENT_ORACLES = 103;
const ERR_CONSENSUS_FAILED = 104;
const ERR_STALE_DATA = 105;
const ERR_ORACLE_NOT_APPROVED = 106;
const ERR_MAX_ORACLES_EXCEEDED = 107;
const ERR_INVALID_WEIGHT = 108;
const ERR_VALUATION_NOT_FOUND = 109;
const ERR_INVALID_TIMESTAMP = 110;
const ERR_MAX_SUBMISSIONS = 111;

interface Valuation {
  value: number;
  timestamp: number;
  sources: number;
}

interface Submission {
  price: number;
  timestamp: number;
}

interface OracleSubmissions {
  count: number;
  lastActive: number;
}

interface OracleWeight {
  oracle: string;
  weight: number;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class ValuationOracleMock {
  state: {
    approvedOracles: string[];
    maxOracles: number;
    consensusThreshold: number;
    maxSubmissions: number;
    stalenessThreshold: number;
    owner: string;
    oracleWeights: Map<string, number>;
    propertyValuations: Map<number, Valuation>;
    submissionHistory: Map<string, Submission>;
    oracleSubmissions: Map<string, OracleSubmissions>;
  } = {
    approvedOracles: [],
    maxOracles: 10,
    consensusThreshold: 3,
    maxSubmissions: 5,
    stalenessThreshold: 3600,
    owner: "ST1OWNER",
    oracleWeights: new Map(),
    propertyValuations: new Map(),
    submissionHistory: new Map(),
    oracleSubmissions: new Map(),
  };
  blockHeight: number = 100;
  caller: string = "ST1ORACLE";

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      approvedOracles: [],
      maxOracles: 10,
      consensusThreshold: 3,
      maxSubmissions: 5,
      stalenessThreshold: 3600,
      owner: "ST1OWNER",
      oracleWeights: new Map(),
      propertyValuations: new Map(),
      submissionHistory: new Map(),
      oracleSubmissions: new Map(),
    };
    this.blockHeight = 100;
    this.caller = "ST1ORACLE";
  }

  getValuation(propertyId: number): Valuation | null {
    return this.state.propertyValuations.get(propertyId) || null;
  }

  getOracleWeight(oracle: string): number | undefined {
    return this.state.oracleWeights.get(oracle);
  }

  getSubmissionHistory(propertyId: number, oracle: string): Submission | null {
    return this.state.submissionHistory.get(`${propertyId}-${oracle}`) || null;
  }

  isOracleApproved(oracle: string): boolean {
    return this.state.approvedOracles.includes(oracle);
  }

  getOracleSubmissions(oracle: string): OracleSubmissions | null {
    return this.state.oracleSubmissions.get(oracle) || null;
  }

  addOracle(oracle: string, weight: number): Result<boolean> {
    if (this.caller !== this.state.owner) return { ok: false, value: false };
    if (this.isOracleApproved(oracle)) return { ok: false, value: false };
    if (weight <= 0 || weight > 100) return { ok: false, value: ERR_INVALID_WEIGHT };
    if (this.state.approvedOracles.length >= this.state.maxOracles) return { ok: false, value: ERR_MAX_ORACLES_EXCEEDED };
    this.state.approvedOracles.push(oracle);
    this.state.oracleWeights.set(oracle, weight);
    return { ok: true, value: true };
  }

  submitDataFeed(propertyId: number, price: number, oracle: string): Result<number> {
    if (this.caller !== oracle) return { ok: false, value: ERR_NOT_ORACLE };
    if (propertyId <= 0) return { ok: false, value: ERR_INVALID_PROPERTY_ID };
    if (price <= 0) return { ok: false, value: ERR_INVALID_PRICE };
    if (!this.isOracleApproved(oracle)) return { ok: false, value: ERR_ORACLE_NOT_APPROVED };
    if (this.blockHeight < (this.blockHeight - this.state.stalenessThreshold)) return { ok: false, value: ERR_STALE_DATA };
    const sub = this.getOracleSubmissions(oracle);
    if (sub && sub.count >= this.state.maxSubmissions) return { ok: false, value: ERR_MAX_SUBMISSIONS };
    this.state.submissionHistory.set(`${propertyId}-${oracle}`, { price, timestamp: this.blockHeight });
    const currentSub = sub || { count: 0, lastActive: 0 };
    this.state.oracleSubmissions.set(oracle, { count: currentSub.count + 1, lastActive: this.blockHeight });
    const prices: number[] = this.state.approvedOracles.map(o => {
      const hist = this.getSubmissionHistory(propertyId, o);
      return hist ? hist.price : 0;
    }).filter(p => p > 0);
    const weights = this.state.approvedOracles.map(o => this.getOracleWeight(o) || 0).filter(w => w > 0);
    if (prices.length < this.state.consensusThreshold) return { ok: false, value: ERR_INSUFFICIENT_ORACLES };
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const median = prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)];
    if (totalWeight < this.state.consensusThreshold) return { ok: false, value: ERR_CONSENSUS_FAILED };
    this.state.propertyValuations.set(propertyId, { value: median, timestamp: this.blockHeight, sources: prices.length });
    return { ok: true, value: price };
  }

  removeOracle(oracle: string): Result<boolean> {
    if (this.caller !== this.state.owner) return { ok: false, value: false };
    if (!this.isOracleApproved(oracle)) return { ok: false, value: false };
    this.state.approvedOracles = this.state.approvedOracles.filter(o => o !== oracle);
    this.state.oracleWeights.delete(oracle);
    return { ok: true, value: true };
  }

  setConsensusThreshold(threshold: number): Result<boolean> {
    if (this.caller !== this.state.owner) return { ok: false, value: false };
    if (threshold <= 0 || threshold > 10) return { ok: false, value: false };
    this.state.consensusThreshold = threshold;
    return { ok: true, value: true };
  }
}

describe("ValuationOracle", () => {
  let contract: ValuationOracleMock;

  beforeEach(() => {
    contract = new ValuationOracleMock();
    contract.reset();
    contract.caller = "ST1OWNER";
    contract.addOracle("ST1ORACLE", 50);
    contract.addOracle("ST2ORACLE", 30);
    contract.addOracle("ST3ORACLE", 20);
    contract.caller = "ST1ORACLE";
  });

  it("adds oracle successfully", () => {
    contract.caller = "ST1OWNER";
    const result = contract.addOracle("ST4ORACLE", 40);
    expect(result.ok).toBe(true);
    expect(contract.isOracleApproved("ST4ORACLE")).toBe(true);
    expect(contract.getOracleWeight("ST4ORACLE")).toBe(40);
  });

  it("rejects adding duplicate oracle", () => {
    contract.caller = "ST1OWNER";
    const result = contract.addOracle("ST1ORACLE", 60);
    expect(result.ok).toBe(false);
  });

  it("rejects adding oracle with invalid weight", () => {
    contract.caller = "ST1OWNER";
    const result = contract.addOracle("ST4ORACLE", 101);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_WEIGHT);
  });

  it("rejects adding oracle beyond max", () => {
    contract.caller = "ST1OWNER";
    contract.state.maxOracles = 3;
    const result = contract.addOracle("ST4ORACLE", 40);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_ORACLES_EXCEEDED);
  });

  it("rejects submission from non-oracle", () => {
    contract.caller = "ST1FAKE";
    const result = contract.submitDataFeed(123, 500000, "ST1ORACLE");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_ORACLE);
  });

  it("rejects invalid property id", () => {
    const result = contract.submitDataFeed(0, 500000, "ST1ORACLE");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_PROPERTY_ID);
  });

  it("rejects invalid price", () => {
    const result = contract.submitDataFeed(123, 0, "ST1ORACLE");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_PRICE);
  });

  it("rejects max submissions exceeded", () => {
    for (let i = 0; i < 5; i++) {
      contract.submitDataFeed(123, 500000 + i, "ST1ORACLE");
    }
    const result = contract.submitDataFeed(123, 600000, "ST1ORACLE");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_SUBMISSIONS);
  });

  it("computes consensus with multiple submissions", () => {
    contract.caller = "ST1ORACLE";
    contract.submitDataFeed(123, 500000, "ST1ORACLE");
    contract.caller = "ST2ORACLE";
    contract.submitDataFeed(123, 520000, "ST2ORACLE");
    contract.caller = "ST3ORACLE";
    contract.submitDataFeed(123, 480000, "ST3ORACLE");
    contract.caller = "ST1ORACLE";
    const valuation = contract.getValuation(123);
    expect(valuation?.value).toBe(500000);
    expect(valuation?.sources).toBe(3);
  });

  it("rejects insufficient oracles for consensus", () => {
    contract.submitDataFeed(123, 500000, "ST1ORACLE");
    contract.caller = "ST2ORACLE";
    contract.submitDataFeed(123, 520000, "ST2ORACLE");
    const valuation = contract.getValuation(123);
    expect(valuation).toBeNull();
  });

  it("removes oracle successfully", () => {
    contract.caller = "ST1OWNER";
    const result = contract.removeOracle("ST1ORACLE");
    expect(result.ok).toBe(true);
    expect(contract.isOracleApproved("ST1ORACLE")).toBe(false);
  });

  it("sets consensus threshold successfully", () => {
    contract.caller = "ST1OWNER";
    const result = contract.setConsensusThreshold(4);
    expect(result.ok).toBe(true);
    expect(contract.state.consensusThreshold).toBe(4);
  });

  it("rejects setting invalid consensus threshold", () => {
    contract.caller = "ST1OWNER";
    const result = contract.setConsensusThreshold(11);
    expect(result.ok).toBe(false);
  });

  it("parses uint with Clarity", () => {
    const cv = uintCV(500000);
    expect(cv.value.toString()).toBe("500000");
  });
});