#include "autoport/game_api.hpp"

namespace autoport {

std::vector<DispatchResult> PlanExecutor::execute(const std::vector<PlannedAction>& actions) {
    std::vector<DispatchResult> results;
    results.reserve(actions.size());
    for (const auto& planned : actions) {
        DispatchResult result;
        if (const auto* spawn = std::get_if<PlannedSpawnEntity>(&planned)) {
            if (spawn->result_id.empty() || handles_.count(spawn->result_id)) {
                result = {false, 0, "spawn result id is empty or already in use"};
            } else {
                result = dispatcher_.dispatch(Action{spawn->action});
                if (result.ok) handles_.emplace(spawn->result_id, result.entity);
            }
        } else if (const auto* transform = std::get_if<PlannedSetTransform>(&planned)) {
            const auto found = handles_.find(transform->entity_ref);
            result = found == handles_.end() ? DispatchResult{false, 0, "transform references an unknown entity id"} :
                dispatcher_.dispatch(Action{SetTransform{found->second, transform->position, transform->rotation, transform->heading}});
        } else if (const auto* attach = std::get_if<PlannedAttachEntity>(&planned)) {
            const auto parent = handles_.find(attach->parent_ref);
            const auto child = handles_.find(attach->child_ref);
            result = parent == handles_.end() || child == handles_.end() ? DispatchResult{false, 0, "attachment references an unknown entity id"} :
                dispatcher_.dispatch(Action{AttachEntity{parent->second, child->second, attach->bone, attach->offset, attach->rotation}});
        } else if (const auto* property = std::get_if<PlannedSetVehicleProperty>(&planned)) {
            const auto found = handles_.find(property->entity_ref);
            result = found == handles_.end() ? DispatchResult{false, 0, "vehicle property references an unknown entity id"} :
                dispatcher_.dispatch(Action{SetVehicleProperty{found->second, property->property, property->value}});
        } else {
            result = {false, 0, "unsupported planned action"};
        }
        results.push_back(result);
        if (!result.ok) break;
    }
    return results;
}

} // namespace autoport
