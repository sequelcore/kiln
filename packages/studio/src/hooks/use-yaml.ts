import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useKilnContext } from "@kilnai/react";

export function useYaml() {
  const { client } = useKilnContext();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["yaml"],
    queryFn: () => client.getText("/dev/yaml"),
  });

  const mutation = useMutation({
    mutationFn: (content: string) => client.putText("/dev/yaml", content),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["yaml"] });
      void queryClient.invalidateQueries({ queryKey: ["app-graph"] });
    },
  });

  return { yaml: query.data, isLoading: query.isLoading, error: query.error, save: mutation.mutate, isSaving: mutation.isPending, saveError: mutation.error };
}
