import { ethers } from "ethers";
import { gql } from "@apollo/client";
import { useState, useEffect } from "react";

import {
  ARBITRUM,
  // AVALANCHE,
  bigNumberify,
} from "../Helpers";
import { arbitrumReferralsGraphClient } from "./common";

function getGraphClient(chainId) {
  if (chainId === ARBITRUM) {
    return arbitrumReferralsGraphClient;
    // } else if (chainId === AVALANCHE) {
    //   return avalancheGraphClient;
  }
  throw new Error(`Unsupported chain ${chainId}`);
}

const DISTRIBUTION_TYPE_REBATES = "1";
const DISTRIBUTION_TYPE_DISCOUNT = "2";

export function decodeReferralCode(hexCode) {
  try {
    return ethers.utils.parseBytes32String(hexCode);
  } catch (ex) {
    let code = "";
    hexCode = hexCode.substring(2);
    for (let i = 0; i < 32; i++) {
      code += String.fromCharCode(parseInt(hexCode.substring(i * 2, i * 2 + 2), 16));
    }
    return code.trim();
  }
}

export function encodeReferralCode(code) {
  if (code.length > 31) {
    throw new Error("Code is too big");
  }
  return ethers.utils.formatBytes32String(code);
}

export function useReferralsData(chainId, account) {
  const [data, setData] = useState();
  useEffect(() => {
    const startOfDayTimestamp = Math.floor(parseInt(Date.now() / 1000) / 86400) * 86400;
    const query = gql(
      `{
      distributions(
        first: 1000,
        orderBy: timestamp,
        orderDirection: desc,
        where: {
          receiver: "__ACCOUNT__",
          typeId_in: ["__DISTRIBUTION_TYPE_REBATES__", "__DISTRIBUTION_TYPE_DISCOUNT__"]
        }
      ) {
        receiver
        amount
        typeId
        token
        transactionHash
        timestamp
      }
      referrerTotalStats: referrerStats(
        first: 1000
        where: {
          period: total
          referrer: "__ACCOUNT__"
        }
      ) {
        referralCode,
        volume,
        trades,
        tradedReferralsCount,
        totalRebateUsd,
        discountUsd
      }
      referrerLastDayStats: referrerStats(
        first: 1000
        where: {
          period: daily
          referrer: "__ACCOUNT__"
          timestamp: __TIMESTAMP__
        }
      ) {
        referralCode,
        volume,
        trades,
        tradedReferralsCount,
        totalRebateUsd,
        discountUsd
      }
      referralCodes (
        first: 1000,
        where: {
          owner: "__ACCOUNT__"
        }
      ) {
        code
      }
      referralTotalStats: referralStat(
        id: "total:0:__ACCOUNT__"
      ) {
        volume,
        discountUsd
      }
    }`
        .replaceAll("__ACCOUNT__", (account || "").toLowerCase())
        .replaceAll("__DISTRIBUTION_TYPE_REBATES__", DISTRIBUTION_TYPE_REBATES)
        .replaceAll("__DISTRIBUTION_TYPE_DISCOUNT__", DISTRIBUTION_TYPE_DISCOUNT)
        .replaceAll("__TIMESTAMP__", startOfDayTimestamp)
    );

    getGraphClient(chainId)
      .query({ query })
      .then((res) => {
        const rebateDistributions = [];
        const discountDistributions = [];
        res.data.distributions.forEach((d) => {
          const item = {
            timestamp: parseInt(d.timestamp),
            transactionHash: d.transactionHash,
            receiver: ethers.utils.getAddress(d.receiver),
            amount: bigNumberify(d.amount),
            typeId: d.typeId,
            token: ethers.utils.getAddress(d.token),
          };
          if (d.typeId === DISTRIBUTION_TYPE_REBATES) {
            rebateDistributions.push(item);
          } else {
            discountDistributions.push(item);
          }
        });

        function prepareStatsItem(e) {
          return {
            volume: bigNumberify(e.volume),
            trades: parseInt(e.trades),
            tradedReferralsCount: parseInt(e.tradedReferralsCount),
            totalRebateUsd: bigNumberify(e.totalRebateUsd),
            discountUsd: bigNumberify(e.discountUsd),
            referralCode: decodeReferralCode(e.referralCode),
          };
        }

        function getCumulativeStats(data = []) {
          return data.reduce(
            (acc, cv) => {
              acc.rebates = acc.rebates.add(cv.totalRebateUsd);
              acc.volume = acc.volume.add(cv.volume);
              acc.discountUsd = acc.discountUsd.add(cv.discountUsd);
              acc.trades = acc.trades + cv.trades;
              acc.referralsCount = acc.referralsCount + cv.tradedReferralsCount;
              return acc;
            },
            {
              rebates: bigNumberify(0),
              volume: bigNumberify(0),
              discountUsd: bigNumberify(0),
              trades: parseInt(0),
              referralsCount: parseInt(0),
            }
          );
        }

        let referrerTotalStats = res.data.referrerTotalStats.map(prepareStatsItem);
        setData({
          rebateDistributions,
          discountDistributions,
          referrerTotalStats,
          referrerLastDayStats: res.data.referrerLastDayStats.map(prepareStatsItem),
          cumulativeStats: getCumulativeStats(referrerTotalStats),
          codes: res.data.referralCodes.map((e) => decodeReferralCode(e.code)),
          referralTotalStats: res.data.referralTotalStats
            ? {
                volume: bigNumberify(res.data.referralTotalStats.volume),
                discountUsd: bigNumberify(res.data.referralTotalStats.discountUsd),
              }
            : {
                volume: bigNumberify(0),
                discountUsd: bigNumberify(0),
              },
        });
      })
      .catch(console.warn);
  }, [setData, chainId, account]);

  return data || null;
}
