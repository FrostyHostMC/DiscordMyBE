#include "autoport/game_api.hpp"
#include <cassert>
#include <cmath>
#include <iostream>
#include <vector>
using namespace autoport;
class FakeGameApi final : public GameApi {
public:
 std::uint32_t spawn_entity(const SpawnEntity&) override { ++spawns; return static_cast<std::uint32_t>(41 + spawns); }
 bool set_transform(const SetTransform&) override { ++transforms; return true; }
 bool attach_entity(const AttachEntity&) override { ++attachments; return !failAttachment; }
 bool set_vehicle_property(const SetVehicleProperty&) override { ++properties; return true; }
 bool set_wanted_level(const SetWantedLevel&) override { ++wanted; return true; }
 bool grant_reward(const GrantReward&) override { ++rewards; return true; }
 bool issue_ped_task(const IssuePedTask&) override { ++tasks; return true; }
 bool set_entity_health(const SetEntityHealth&) override { ++health; return true; }
 bool create_explosion(const CreateExplosion&) override { ++explosions; return true; }
 bool delete_entity(std::uint32_t entity) override { if (failDelete) return false; deleted.push_back(entity); return true; }
 int spawns{0}, transforms{0}, attachments{0}, properties{0}, wanted{0}, rewards{0}, tasks{0}, health{0}, explosions{0};
 bool failAttachment{false}, failDelete{false};
 std::vector<std::uint32_t> deleted;
};
int main() {
 FakeGameApi api;
 Dispatcher dispatcher(api);
 const auto spawned = dispatcher.dispatch(SpawnEntity{EntityKind::Vehicle, "adder", {1,2,3}, {0,0,0}, 90});
 assert(spawned.ok && spawned.entity == 42 && api.spawns == 1);
 const auto badModel = dispatcher.dispatch(SpawnEntity{EntityKind::Vehicle, "", {1,2,3}, {0,0,0}, 0});
 assert(!badModel.ok && api.spawns == 1);
 const auto badVector = dispatcher.dispatch(SetTransform{42, {NAN,0,0}, {0,0,0}, 0});
 assert(!badVector.ok && api.transforms == 0);
 assert(dispatcher.dispatch(AttachEntity{42, 43, "chassis", {0,1,0}, {0,0,0}}).ok);
 assert(dispatcher.dispatch(SetVehicleProperty{42, "livery", 2}).ok);
 assert(dispatcher.dispatch(SetWantedLevel{5}).ok);
 assert(!dispatcher.dispatch(SetWantedLevel{6}).ok);
 assert(dispatcher.dispatch(GrantReward{500}).ok);
 assert(!dispatcher.dispatch(GrantReward{-1}).ok);
 assert(dispatcher.dispatch(IssuePedTask{55, "follow_player", 0}).ok);
 assert(dispatcher.dispatch(SetEntityHealth{55, 175}).ok);
 assert(!dispatcher.dispatch(SetEntityHealth{55, 10001}).ok);
 assert(dispatcher.dispatch(CreateExplosion{{1,2,3}, 2, 1.0f}).ok);
 assert(!dispatcher.dispatch(CreateExplosion{{1,2,3}, 2, 99.0f}).ok);
 PlanExecutor executor(api);
 const std::vector<PlannedAction> goodPlan = {
  PlannedSpawnEntity{"car", SpawnEntity{EntityKind::Vehicle, "adder", {0,0,0}, {0,0,0}, 0}},
  PlannedSpawnEntity{"minigun", SpawnEntity{EntityKind::Object, "prop_minigun_01", {0,0,0}, {0,0,0}, 0}},
  PlannedAttachEntity{"car", "minigun", "chassis", {0,1,0}, {0,0,0}},
  PlannedSetVehicleProperty{"car", "livery", 2},
 };
 const auto goodResults = executor.execute(goodPlan);
 assert(goodResults.size() == 4);
 for (const auto& result : goodResults) assert(result.ok);
 assert(executor.entity_count() == 2);
 api.failAttachment = true;
 const std::vector<PlannedAction> badPlan = {
  PlannedSpawnEntity{"failed-car", SpawnEntity{EntityKind::Vehicle, "adder", {0,0,0}, {0,0,0}, 0}},
  PlannedSpawnEntity{"failed-object", SpawnEntity{EntityKind::Object, "prop_minigun_01", {0,0,0}, {0,0,0}, 0}},
  PlannedAttachEntity{"failed-car", "failed-object", "chassis", {0,1,0}, {0,0,0}},
 };
 const auto badResults = executor.execute(badPlan);
 assert(badResults.size() == 3 && !badResults.back().ok);
 assert(executor.entity_count() == 2);
 assert(api.deleted.size() == 2);
 assert(api.deleted[0] == 46 && api.deleted[1] == 45);
 api.failAttachment = false;
 api.failDelete = true;
 executor.clear();
 assert(executor.entity_count() == 2);
 api.failDelete = false;
 executor.clear();
 assert(executor.entity_count() == 0);
 const auto missingRef = executor.execute({PlannedSetTransform{"missing", {0,0,0}, {0,0,0}, 0}});
 assert(missingRef.size() == 1 && !missingRef.front().ok);
 std::cout << "native runtime core tests passed\n";
 return 0;
}
