#include "autoport/game_api.hpp"
#include <algorithm>
namespace autoport {
std::vector<DispatchResult> PlanExecutor::execute(const std::vector<PlannedAction>& actions) {
 std::vector<DispatchResult> results;
 results.reserve(actions.size());
 std::vector<std::string> createdThisRun;
 const auto rollback = [this, &createdThisRun](DispatchResult& failure) {
  for (auto it = createdThisRun.rbegin(); it != createdThisRun.rend(); ++it) {
   const auto found = handles_.find(*it);
   if (found == handles_.end()) continue;
   if (dispatcher_.destroy_entity(found->second)) {
    handles_.erase(found);
    creation_order_.erase(std::remove(creation_order_.begin(), creation_order_.end(), *it), creation_order_.end());
   } else {
    const std::string message = "rollback could not delete entity '" + *it + "'; handle retained for clear() retry";
    if (!failure.error.empty()) failure.error += "; ";
    failure.error += message;
   }
  }
 };
 for (const auto& planned : actions) {
  DispatchResult result;
  if (const auto* spawn = std::get_if<PlannedSpawnEntity>(&planned)) {
   if (spawn->result_id.empty() || handles_.count(spawn->result_id)) result = {false, 0, "spawn result id is empty or already in use"};
   else {
    result = dispatcher_.dispatch(Action{spawn->action});
    if (result.ok) {
     handles_.emplace(spawn->result_id, result.entity);
     creation_order_.push_back(spawn->result_id);
     createdThisRun.push_back(spawn->result_id);
    }
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
  } else result = {false, 0, "unsupported planned action"};
  results.push_back(result);
  if (!result.ok) { rollback(results.back()); break; }
 }
 return results;
}
void PlanExecutor::clear() {
 std::size_t index = creation_order_.size();
 while (index > 0) {
  --index;
  const std::string id = creation_order_[index];
  const auto found = handles_.find(id);
  if (found == handles_.end()) {
   creation_order_.erase(creation_order_.begin() + static_cast<std::ptrdiff_t>(index));
   continue;
  }
  if (dispatcher_.destroy_entity(found->second)) {
   handles_.erase(found);
   creation_order_.erase(creation_order_.begin() + static_cast<std::ptrdiff_t>(index));
  }
 }
}
} // namespace autoport
