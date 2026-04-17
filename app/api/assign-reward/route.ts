import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";



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

export async function POST(req: Request) {
  try {
    console.log("URL:", process.env.NEXT_PUBLIC_SUPABASE_URL);
    console.log("KEY:", process.env.SUPABASE_SERVICE_ROLE_KEY ? "exists" : "missing");
    
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { email } = await req.json();

    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    console.log("CHECKING campaign_rewards for email:", email);
    const { data: existing, error: existingError } = await supabase
      .from("campaign_rewards")
      .select("*")
      .eq("email", email)
      .eq("campaign_name", "glotrition_scratch")
      .maybeSingle();

    if (existingError) {
      return NextResponse.json(
        { error: existingError.message },
        { status: 500 }
      );
    }

    if (existing) {
      return NextResponse.json({
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
        return NextResponse.json(
          { error: freeCodeError.message },
          { status: 500 }
        );
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
          return NextResponse.json(
            { error: updateError.message },
            { status: 500 }
          );
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
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      alreadyAssigned: false,
      reward: inserted,
    });
  } catch (error) {
    console.error("FULL ERROR:", error);
    
    const message =
    error instanceof Error ? error.message : "Unexpected server error";

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}