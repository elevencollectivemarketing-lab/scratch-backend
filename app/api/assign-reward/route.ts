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
    {
      type: "20%",
      weight: 70,
      label: "20% OFF",
    },
    {
      type: "30%",
      weight: 30,
      label: "30% OFF",
    },
  ];

  const total = rewards.reduce(
    (sum, reward) => sum + reward.weight,
    0
  );

  let random = Math.random() * total;

  for (const reward of rewards) {
    if (random < reward.weight) {
      return reward;
    }

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
    console.log("assign-reward: request started");

    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL;

    const supabaseKey =
      process.env.SUPABASE_SECRET_KEY;

    if (!supabaseUrl) {
      console.error(
        "assign-reward: NEXT_PUBLIC_SUPABASE_URL is missing"
      );

      return jsonResponse(
        {
          error:
            "NEXT_PUBLIC_SUPABASE_URL environment variable is missing",
        },
        500
      );
    }

    if (!supabaseKey) {
      console.error(
        "assign-reward: SUPABASE_SECRET_KEY is missing"
      );

      return jsonResponse(
        {
          error:
            "SUPABASE_SECRET_KEY environment variable is missing",
        },
        500
      );
    }

    console.log(
      "assign-reward: Supabase environment variables found"
    );

    const supabase = createClient(
      supabaseUrl,
      supabaseKey
    );

    const body = await req.json();

    const email =
      typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : "";

    console.log(
      "assign-reward: email received:",
      email
    );

    if (!email) {
      console.error(
        "assign-reward: email missing"
      );

      return jsonResponse(
        {
          error: "Email is required",
        },
        400
      );
    }

    /*
     * --------------------------------
     * CHECK FOR AN EXISTING REWARD
     * --------------------------------
     */

    console.log(
      "assign-reward: checking existing reward"
    );

    const {
      data: existing,
      error: existingError,
    } = await supabase
      .from("campaign_rewards")
      .select("*")
      .eq("email", email)
      .eq(
        "campaign_name",
        "glotrition_scratch"
      )
      .maybeSingle();

    if (existingError) {
      console.error(
        "assign-reward: existing reward lookup failed:",
        existingError
      );

      return jsonResponse(
        {
          error: existingError.message,
        },
        500
      );
    }

    /*
     * If this email already received
     * a reward, return the same reward.
     */

    if (existing) {
      console.log(
        "assign-reward: existing reward found"
      );

      return jsonResponse({
        alreadyAssigned: true,
        reward: existing,
      });
    }

    console.log(
      "assign-reward: no existing reward found"
    );

    /*
     * --------------------------------
     * PICK STANDARD REWARD
     * --------------------------------
     */

    let selectedReward: {
      type: string;
      label: string;
    } = pickWeightedReward();

    let discountCode: string | null =
      null;

    console.log(
      "assign-reward: weighted reward selected:",
      selectedReward.type
    );

    /*
     * --------------------------------
     * CHECK FOR FREE ORDER
     * --------------------------------
     */

    if (shouldAssignFreeOrder()) {
      console.log(
        "assign-reward: free-order draw triggered"
      );

      console.log(
        "assign-reward: checking available free-order codes"
      );

      const {
        data: freeCode,
        error: freeCodeError,
      } = await supabase
        .from("free_reward_codes")
        .select("*")
        .eq(
          "campaign_name",
          "glotrition_scratch"
        )
        .eq(
          "is_assigned",
          false
        )
        .limit(1)
        .maybeSingle();

      if (freeCodeError) {
        console.error(
          "assign-reward: free code lookup failed:",
          freeCodeError
        );

        return jsonResponse(
          {
            error: freeCodeError.message,
          },
          500
        );
      }

      /*
       * Only award FREE ORDER if
       * an unused code actually exists.
       */

      if (freeCode) {
        console.log(
          "assign-reward: unused free-order code found"
        );

        selectedReward = {
          type: "FREE_ORDER",
          label: "FREE ORDER",
        };

        discountCode =
          freeCode.code;

        console.log(
          "assign-reward: assigning free-order code"
        );

        const {
          error: updateError,
        } = await supabase
          .from("free_reward_codes")
          .update({
            is_assigned: true,
            assigned_to_email: email,
            assigned_at:
              new Date().toISOString(),
          })
          .eq(
            "id",
            freeCode.id
          );

        if (updateError) {
          console.error(
            "assign-reward: free code update failed:",
            updateError
          );

          return jsonResponse(
            {
              error:
                updateError.message,
            },
            500
          );
        }

        console.log(
          "assign-reward: free-order code assigned successfully"
        );
      } else {
        console.log(
          "assign-reward: no unused free-order codes available"
        );
      }
    } else {
      console.log(
        "assign-reward: free-order draw not triggered"
      );
    }

    /*
     * --------------------------------
     * CREATE UNIQUE REWARD TOKEN
     * --------------------------------
     */

    const token =
      crypto.randomUUID();

    /*
     * --------------------------------
     * SAVE REWARD
     * --------------------------------
     */

    console.log(
      "assign-reward: inserting campaign reward"
    );

    console.log(
      "assign-reward: reward type:",
      selectedReward.type
    );

    const {
      data: inserted,
      error: insertError,
    } = await supabase
      .from("campaign_rewards")
      .insert({
        campaign_name:
          "glotrition_scratch",

        email,

        token,

        reward_type:
          selectedReward.type,

        discount_code:
          discountCode,

        label:
          selectedReward.label,

        description:
          "Scratch reward",

        assigned_at:
          new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      console.error(
        "assign-reward: campaign reward insert failed:",
        insertError
      );

      return jsonResponse(
        {
          error: insertError.message,
        },
        500
      );
    }

    /*
     * --------------------------------
     * SUCCESS
     * --------------------------------
     */

    console.log(
      "assign-reward: reward inserted successfully"
    );

    return jsonResponse({
      alreadyAssigned: false,
      reward: inserted,
    });
  } catch (error) {
    console.error(
      "assign-reward: unexpected error:",
      error
    );

    const message =
      error instanceof Error
        ? error.message
        : "Unexpected server error";

    return jsonResponse(
      {
        error: message,
      },
      500
    );
  }
}
