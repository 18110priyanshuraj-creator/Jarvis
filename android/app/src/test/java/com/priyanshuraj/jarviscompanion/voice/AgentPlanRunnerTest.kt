package com.priyanshuraj.jarviscompanion.voice

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AgentPlanRunnerTest {
    @Test
    fun validatesAndPreviewsAUsableSearchPlan() {
        val plan = JSONObject(
            """
            {
              "mode": "device_action",
              "reply": "I will open Chrome and search for JEE Physics.",
              "actions": [
                {"type":"open_app","value":"Chrome","purpose":"Open the requested app."},
                {"type":"tap_label","value":"Search","purpose":"Open visible search."},
                {"type":"type_text","value":"JEE Physics","purpose":"Enter search phrase."},
                {"type":"ask_user","value":"Choose the result yourself.","purpose":"Keep result choice with the user."}
              ]
            }
            """.trimIndent()
        )

        val actions = AgentPlanRunner.validate(plan)
        assertEquals(4, actions.length())
        assertTrue(AgentPlanRunner.describe(plan).contains("Open Chrome"))
        assertEquals(
            "open app → tap label → type text → ask user",
            AgentPlanRunner.actionKinds(plan)
        )
    }

    @Test
    fun rejectsProtectedScreenControlsBeforePreview() {
        val plan = JSONObject(
            """
            {
              "actions": [
                {"type":"tap_label","value":"Delete account"}
              ]
            }
            """.trimIndent()
        )

        expectIllegalArgument { AgentPlanRunner.validate(plan) }
    }

    @Test
    fun rejectsSensitiveOrNumericTextBeforePreview() {
        val passwordPlan = JSONObject(
            """
            {
              "actions": [
                {"type":"type_text","value":"my password is secret"}
              ]
            }
            """.trimIndent()
        )
        val numericCodePlan = JSONObject(
            """
            {
              "actions": [
                {"type":"type_text","value":"123456"}
              ]
            }
            """.trimIndent()
        )

        expectIllegalArgument { AgentPlanRunner.validate(passwordPlan) }
        expectIllegalArgument { AgentPlanRunner.validate(numericCodePlan) }
    }

    @Test
    fun rejectsPermissionAndFinancialControlsUsingTheSharedPolicy() {
        listOf("Allow", "Grant permission", "Confirm transfer", "Delete account", "Card number").forEach { label ->
            val plan = JSONObject(
                """
                {
                  "actions": [
                    {"type":"tap_label","value":"$label"}
                  ]
                }
                """.trimIndent()
            )
            expectIllegalArgument { AgentPlanRunner.validate(plan) }
        }

        val cvvPlan = JSONObject(
            """
            {
              "actions": [
                {"type":"type_text","value":"CVV 123"}
              ]
            }
            """.trimIndent()
        )
        expectIllegalArgument { AgentPlanRunner.validate(cvvPlan) }
    }

    @Test
    fun rejectsMissingOrOversizedActionLists() {
        expectIllegalArgument { AgentPlanRunner.validate(JSONObject()) }

        val actions = (1..7).joinToString(",") {
            """{"type":"open_app","value":"App $it"}"""
        }
        val oversized = JSONObject("""{"actions":[$actions]}""")
        expectIllegalArgument { AgentPlanRunner.validate(oversized) }
    }

    private fun expectIllegalArgument(block: () -> Unit) {
        try {
            block()
            throw AssertionError("Expected plan validation to reject this input.")
        } catch (_: IllegalArgumentException) {
            // Expected: the on-device validator rejected an unsafe or invalid plan.
        }
    }
}
