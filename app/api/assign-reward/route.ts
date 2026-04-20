import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://glotrition.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data: unknown, status = 200) {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function pickWeightedReward() {
  const rewards = [
    { type: "20%", weight: 70, label: "20% OFF" },
    { type: "30%", weight: 30, label: "30% OFF" },
  ];

  const total = rewards.reduce((sum, reward) => sum + reward.weight, 0);
  let random = Math.random() * total;

  for (const reward of rewards) {
    if (random < reward.weight) return reward;
    random -= reward.weight;
  }

  return rewards[0];
}

function shouldAssignFreeOrder() {
  return Math.random() < 0.05;
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
}

export async function POST(req: Request) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!
    );

    const { email } = await req.json();

    if (!email) {
      return jsonResponse({ error: "Email is required" }, 400);
    }

    const { data: existing, error: existingError } = await supabase
      .from("campaign_rewards")
      .select("*")
      .eq("email", email)
      .eq("campaign_name", "glotrition_scratch")
      .maybeSingle();

    if (existingError) {
      return jsonResponse({ error: existingError.message }, 500);
    }

    if (existing) {
      return jsonResponse({
        alreadyAssigned: true,
        reward: existing,
      });
    }

    let selectedReward: { type: string; label: string } = pickWeightedReward();
    let discountCode: string | null = null;

    if (shouldAssignFreeOrder()) {
      const { data: freeCode, error: freeCodeError } = await supabase
        .from("free_reward_codes")
        .select("*")
        .eq("campaign_name", "glotrition_scratch")
        .eq("is_assigned", false)
        .limit(1)
        .maybeSingle();

      if (freeCodeError) {
        return jsonResponse({ error: freeCodeError.message }, 500);
      }

      if (freeCode) {
        selectedReward = {
          type: "FREE_ORDER",
          label: "FREE ORDER",
        };

        discountCode = freeCode.code;

        const { error: updateError } = await supabase
          .from("free_reward_codes")
          .update({
            is_assigned: true,
            assigned_to_email: email,
            assigned_at: new Date().toISOString(),
          })
          .eq("id", freeCode.id);

        if (updateError) {
          return jsonResponse({ error: updateError.message }, 500);
        }
      }
    }

    const token = crypto.randomUUID();

    const { data: inserted, error: insertError } = await supabase
      .from("campaign_rewards")
      .insert({
        campaign_name: "glotrition_scratch",
        email,
        token,
        reward_type: selectedReward.type,
        discount_code: discountCode,
        label: selectedReward.label,
        description: "Scratch reward",
        assigned_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      return jsonResponse({ error: insertError.message }, 500);
    }

    return jsonResponse({
      alreadyAssigned: false,
      reward: inserted,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected server error";

    return jsonResponse({ error: message }, 500);
  }
}